import {expect, describe, it, jest, beforeEach} from '@jest/globals';
import configUtil from '../../../src/utils/config.util.js';
import { HTTP_STATUS_BAD_REQUEST } from '../../../src/constants/http.status.constants.js';
import {taxHandler} from "../../../src/controllers/tax.calculator.controller.js";

describe('tax-calculator.controller.spec', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
    const mockResponse = {
      status: () => {
        return {
          send: () => {},
        };
      },
    };

    const responseStatusSpy = jest.spyOn(mockResponse, 'status')
    await taxHandler(mockRequest, mockResponse);
    expect(responseStatusSpy).toBeCalledWith(HTTP_STATUS_BAD_REQUEST);
  });

  describe('tax behavior configuration', () => {
    it('should use exclusive tax behavior when taxBehaviorDefault is not configured', async () => {
      const dummyConfig = {
        clientId: 'dummy-ctp-client-id',
        clientSecret: 'dummy-ctp-client-secret',
        projectKey: 'dummy-ctp-project-key',
        scope: 'dummy-ctp-scope',
        region: 'dummy-ctp-region',
        stripeApiToken: 'sk_test_dummy-stripe-api-token',
        // taxBehaviorDefault not set
      };

      jest
        .spyOn(configUtil, "readConfiguration")
        .mockImplementation(({ success }) => success(dummyConfig));

      const mockRequest = {
        method: 'POST',
        url: '/',
        body: {
          resource: {
            obj: {
              id: 'test-cart-id',
              country: 'US',
              currency: 'USD',
              lineItems: [{
                id: 'line-item-1',
                totalPrice: { centAmount: 10000, currencyCode: 'USD' }
              }],
              shippingMode: 'Single',
              shippingAddress: {
                country: 'US',
                streetName: 'Test Street',
                postalCode: '12345',
                city: 'Test City',
                state: 'CA'
              }
            }
          }
        },
      };

      const mockResponse = {
        status: () => ({
          send: () => {},
        }),
      };

      // Mock Stripe to avoid actual API calls
      const mockStripe = {
        tax: {
          calculations: {
            create: jest.fn().mockResolvedValue({
              id: 'tax_calc_123',
              currency: 'usd',
              tax_breakdown: [{
                tax_rate_details: {
                  tax_type: 'vat',
                  percentage_decimal: 850,
                  country: 'US'
                }
              }],
              line_items: {
                data: [{
                  reference: 'line-item-1',
                  amount_tax: 850
                }]
              }
            })
          }
        }
      };

      // Mock the stripe import
      jest.doMock('stripe', () => jest.fn(() => mockStripe));

      await taxHandler(mockRequest, mockResponse);

      // Verify that Stripe was called with exclusive tax behavior
      expect(mockStripe.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: expect.arrayContaining([
            expect.objectContaining({
              tax_behavior: 'exclusive'
            })
          ])
        })
      );
    });

    it('should use configured tax behavior when taxBehaviorDefault is set', async () => {
      const dummyConfig = {
        clientId: 'dummy-ctp-client-id',
        clientSecret: 'dummy-ctp-client-secret',
        projectKey: 'dummy-ctp-project-key',
        scope: 'dummy-ctp-scope',
        region: 'dummy-ctp-region',
        stripeApiToken: 'sk_test_dummy-stripe-api-token',
        taxBehaviorDefault: 'inclusive'
      };

      jest
        .spyOn(configUtil, "readConfiguration")
        .mockImplementation(({ success }) => success(dummyConfig));

      const mockRequest = {
        method: 'POST',
        url: '/',
        body: {
          resource: {
            obj: {
              id: 'test-cart-id',
              country: 'DE',
              currency: 'EUR',
              lineItems: [{
                id: 'line-item-1',
                totalPrice: { centAmount: 10000, currencyCode: 'EUR' }
              }],
              shippingMode: 'Single',
              shippingAddress: {
                country: 'DE',
                streetName: 'Test Street',
                postalCode: '12345',
                city: 'Test City',
                state: 'BY'
              }
            }
          }
        },
      };

      const mockResponse = {
        status: () => ({
          send: () => {},
        }),
      };

      // Mock Stripe to avoid actual API calls
      const mockStripe = {
        tax: {
          calculations: {
            create: jest.fn().mockResolvedValue({
              id: 'tax_calc_123',
              currency: 'eur',
              tax_breakdown: [{
                tax_rate_details: {
                  tax_type: 'vat',
                  percentage_decimal: 1900,
                  country: 'DE'
                }
              }],
              line_items: {
                data: [{
                  reference: 'line-item-1',
                  amount_tax: 1900
                }]
              }
            })
          }
        }
      };

      // Mock the stripe import
      jest.doMock('stripe', () => jest.fn(() => mockStripe));

      await taxHandler(mockRequest, mockResponse);

      // Verify that Stripe was called with inclusive tax behavior
      expect(mockStripe.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: expect.arrayContaining([
            expect.objectContaining({
              tax_behavior: 'inclusive'
            })
          ])
        })
      );
    });
  });

});
