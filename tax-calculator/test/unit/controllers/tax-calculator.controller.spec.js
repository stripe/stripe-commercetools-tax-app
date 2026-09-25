import {expect, describe, it, jest, beforeEach} from '@jest/globals';
import configUtil from '../../../src/utils/config.util.js';
import { HTTP_STATUS_BAD_REQUEST, HTTP_STATUS_SUCCESS_ACCEPTED } from '../../../src/constants/http.status.constants.js';
import {taxHandler} from "../../../src/controllers/tax.calculator.controller.js";

jest.mock('../../../src/services/tax-orchestrator.service.js', () => ({
  __esModule: true,
  default: {
    orchestrateTaxCalculation: jest.fn(),
    reapplyExistingCalculation: jest.fn(),
  }
}));

jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import taxOrchestratorService from '../../../src/services/tax-orchestrator.service.js';

describe('tax-calculator.controller.spec', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockResponse = () => {
    const res = { status: jest.fn() };
    res.status.mockReturnValue({ send: jest.fn() });
    return res;
  };

  it(`should return 400 HTTP status when message data is missing in incoming event message.`, async () => {
    const dummyConfig = {
      clientId: 'dummy-ctp-client-id',
      clientSecret: 'dummy-ctp-client-secret',
      projectKey: 'dummy-ctp-project-key',
      scope: 'dummy-ctp-scope',
      region: 'dummy-ctp-region',
      stripeApiToken: 'sk_test_dummy-stripe-api-token',
    };

    jest
        .spyOn(configUtil, "readConfiguration")
        .mockImplementation(({ success }) => success(dummyConfig));

    const mockRequest = {
      method: 'POST',
      url: '/',
      body: {
        message: {},
      },
    };
    const res = mockResponse();

    await taxHandler(mockRequest, res);
    expect(res.status).toBeCalledWith(HTTP_STATUS_BAD_REQUEST);
  });

  describe('re-apply scenario routing', () => {
    const makeRequest = (cart) => ({
      method: 'POST',
      url: '/',
      body: { resource: { obj: cart } }
    });

    it('should call orchestrateTaxCalculation when paymentInfo is absent', async () => {
      const cart = {
        id: 'cart-1',
        lineItems: [{ id: 'li-1' }],
        totalPrice: { currencyCode: 'USD', centAmount: 1000 },
        taxedPrice: { totalGross: { centAmount: 1089 } },
        shippingMode: 'Single',
        country: 'US',
      };
      taxOrchestratorService.orchestrateTaxCalculation.mockResolvedValue({ actions: [] });

      const res = mockResponse();
      await taxHandler(makeRequest(cart), res);

      expect(taxOrchestratorService.orchestrateTaxCalculation).toHaveBeenCalledWith(cart);
      expect(taxOrchestratorService.reapplyExistingCalculation).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
    });

    it('should call orchestrateTaxCalculation when paymentInfo is present but taxedPrice is also present', async () => {
      const cart = {
        id: 'cart-2',
        lineItems: [{ id: 'li-1' }],
        totalPrice: { currencyCode: 'USD', centAmount: 1000 },
        paymentInfo: { payments: [{ typeId: 'payment', id: 'pay-1' }] },
        taxedPrice: { totalGross: { centAmount: 1089 } },
        shippingMode: 'Single',
        country: 'US',
        custom: { fields: { connectorStripeTax_calculationReferences: ['taxcalc_abc'] } }
      };
      taxOrchestratorService.orchestrateTaxCalculation.mockResolvedValue({ actions: [] });

      const res = mockResponse();
      await taxHandler(makeRequest(cart), res);

      expect(taxOrchestratorService.orchestrateTaxCalculation).toHaveBeenCalledWith(cart);
      expect(taxOrchestratorService.reapplyExistingCalculation).not.toHaveBeenCalled();
    });

    it('should call orchestrateTaxCalculation when paymentInfo is present but no calculation references exist', async () => {
      const cart = {
        id: 'cart-3',
        lineItems: [{ id: 'li-1' }],
        totalPrice: { currencyCode: 'USD', centAmount: 1000 },
        paymentInfo: { payments: [{ typeId: 'payment', id: 'pay-1' }] },
        shippingMode: 'Single',
        country: 'US',
      };
      taxOrchestratorService.orchestrateTaxCalculation.mockResolvedValue({ actions: [] });

      const res = mockResponse();
      await taxHandler(makeRequest(cart), res);

      expect(taxOrchestratorService.orchestrateTaxCalculation).toHaveBeenCalledWith(cart);
      expect(taxOrchestratorService.reapplyExistingCalculation).not.toHaveBeenCalled();
    });

    it('should call reapplyExistingCalculation when paymentInfo present, taxedPrice absent, and calculation reference exists', async () => {
      const cart = {
        id: 'cart-4',
        lineItems: [{ id: 'li-1' }],
        totalPrice: { currencyCode: 'USD', centAmount: 1000 },
        paymentInfo: { payments: [{ typeId: 'payment', id: 'pay-1' }] },
        shippingMode: 'Single',
        country: 'US',
        custom: { fields: { connectorStripeTax_calculationReferences: ['taxcalc_xyz'] } }
      };
      taxOrchestratorService.reapplyExistingCalculation.mockResolvedValue({ actions: [{ action: 'setCartTotalTax' }] });

      const res = mockResponse();
      await taxHandler(makeRequest(cart), res);

      expect(taxOrchestratorService.reapplyExistingCalculation).toHaveBeenCalledWith(cart);
      expect(taxOrchestratorService.orchestrateTaxCalculation).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
    });

    it('should call reapplyExistingCalculation when paymentInfo present, cart taxedPrice present but shippingInfo.taxedPrice absent (Express Checkout case)', async () => {
      const cart = {
        id: 'cart-5',
        lineItems: [{ id: 'li-1' }],
        totalPrice: { currencyCode: 'USD', centAmount: 6800 },
        taxedPrice: { totalGross: { centAmount: 6800 } },
        paymentInfo: { payments: [{ typeId: 'payment', id: 'pay-1' }] },
        shippingMode: 'Single',
        shippingInfo: { shippingMethodName: 'Express US', price: { centAmount: 3000 } },
        country: 'US',
        custom: { fields: { connectorStripeTax_calculationReferences: ['taxcalc_express'] } }
      };
      taxOrchestratorService.reapplyExistingCalculation.mockResolvedValue({ actions: [{ action: 'setShippingMethodTaxAmount' }] });

      const res = mockResponse();
      await taxHandler(makeRequest(cart), res);

      expect(taxOrchestratorService.reapplyExistingCalculation).toHaveBeenCalledWith(cart);
      expect(taxOrchestratorService.orchestrateTaxCalculation).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(HTTP_STATUS_SUCCESS_ACCEPTED);
    });

    it('should call orchestrateTaxCalculation when paymentInfo present, taxedPrice present, shippingInfo.taxedPrice present', async () => {
      const cart = {
        id: 'cart-6',
        lineItems: [{ id: 'li-1' }],
        totalPrice: { currencyCode: 'USD', centAmount: 6800 },
        taxedPrice: { totalGross: { centAmount: 6800 } },
        paymentInfo: { payments: [{ typeId: 'payment', id: 'pay-1' }] },
        shippingMode: 'Single',
        shippingInfo: {
          shippingMethodName: 'Express US',
          price: { centAmount: 3000 },
          taxedPrice: { totalGross: { centAmount: 3000 } }
        },
        country: 'US',
        custom: { fields: { connectorStripeTax_calculationReferences: ['taxcalc_ok'] } }
      };
      taxOrchestratorService.orchestrateTaxCalculation.mockResolvedValue({ actions: [] });

      const res = mockResponse();
      await taxHandler(makeRequest(cart), res);

      expect(taxOrchestratorService.orchestrateTaxCalculation).toHaveBeenCalledWith(cart);
      expect(taxOrchestratorService.reapplyExistingCalculation).not.toHaveBeenCalled();
    });

    it('should call orchestrateTaxCalculation when shippingMode is Multiple and taxedPrice is present', async () => {
      const cart = {
        id: 'cart-7',
        lineItems: [{ id: 'li-1' }],
        totalPrice: { currencyCode: 'USD', centAmount: 5000 },
        taxedPrice: { totalGross: { centAmount: 5000 } },
        paymentInfo: { payments: [{ typeId: 'payment', id: 'pay-1' }] },
        shippingMode: 'Multiple',
        shipping: [{ shippingKey: 'ship-1' }],
        country: 'US',
        custom: { fields: { connectorStripeTax_calculationReferences: ['taxcalc_multi'] } }
      };
      taxOrchestratorService.orchestrateTaxCalculation.mockResolvedValue({ actions: [] });

      const res = mockResponse();
      await taxHandler(makeRequest(cart), res);

      expect(taxOrchestratorService.orchestrateTaxCalculation).toHaveBeenCalledWith(cart);
      expect(taxOrchestratorService.reapplyExistingCalculation).not.toHaveBeenCalled();
    });
  });
});
