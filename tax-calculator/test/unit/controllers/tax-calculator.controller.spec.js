import {expect, describe, it, jest, beforeEach} from '@jest/globals';
import configUtil from '../../../src/utils/config.util.js';
import { HTTP_STATUS_BAD_REQUEST } from '../../../src/constants/http.status.constants.js';
import { TAX_BEHAVIOR_INCLUSIVE, TAX_BEHAVIOR_EXCLUSIVE } from '../../../src/constants/tax-behavior.constants.js';
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
    it('should use country mapping when available', async () => {
      const dummyConfig = {
        clientId: 'dummy-ctp-client-id',
        clientSecret: 'dummy-ctp-client-secret',
        projectKey: 'dummy-ctp-project-key',
        scope: 'dummy-ctp-scope',
        region: 'dummy-ctp-region',
        stripeApiToken: 'sk_test_dummy-stripe-api-token',
        countryTaxBehaviorMapping: '{"DE":"inclusive"}'
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

      // Verify that Stripe was called with inclusive tax behavior from country mapping
      expect(mockStripe.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: expect.arrayContaining([
            expect.objectContaining({
              tax_behavior: TAX_BEHAVIOR_INCLUSIVE
            })
          ])
        })
      );
    });

    it('should use merchant default when no country mapping is available', async () => {
      const dummyConfig = {
        clientId: 'dummy-ctp-client-id',
        clientSecret: 'dummy-ctp-client-secret',
        projectKey: 'dummy-ctp-project-key',
        scope: 'dummy-ctp-scope',
        region: 'dummy-ctp-region',
        stripeApiToken: 'sk_test_dummy-stripe-api-token',
        taxBehaviorDefault: TAX_BEHAVIOR_INCLUSIVE
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

      // Verify that Stripe was called with inclusive tax behavior from merchant default
      expect(mockStripe.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: expect.arrayContaining([
            expect.objectContaining({
              tax_behavior: TAX_BEHAVIOR_INCLUSIVE
            })
          ])
        })
      );
    });

    it('should use merchant default when country mapping is not configured', async () => {
      const dummyConfig = {
        clientId: 'dummy-ctp-client-id',
        clientSecret: 'dummy-ctp-client-secret',
        projectKey: 'dummy-ctp-project-key',
        scope: 'dummy-ctp-scope',
        region: 'dummy-ctp-region',
        stripeApiToken: 'sk_test_dummy-stripe-api-token',
        taxBehaviorDefault: TAX_BEHAVIOR_INCLUSIVE
        // countryTaxBehaviorMapping not set
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

      // Verify that Stripe was called with inclusive tax behavior from merchant default
      expect(mockStripe.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: expect.arrayContaining([
            expect.objectContaining({
              tax_behavior: TAX_BEHAVIOR_INCLUSIVE
            })
          ])
        })
      );
    });

    it('should use exclusive tax behavior when configured', async () => {
      const dummyConfig = {
        clientId: 'dummy-ctp-client-id',
        clientSecret: 'dummy-ctp-client-secret',
        projectKey: 'dummy-ctp-project-key',
        scope: 'dummy-ctp-scope',
        region: 'dummy-ctp-region',
        stripeApiToken: 'sk_test_dummy-stripe-api-token',
        taxBehaviorDefault: TAX_BEHAVIOR_EXCLUSIVE
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

      const mockStripe = {
        tax: {
          calculations: {
            create: jest.fn().mockResolvedValue({
              id: 'tax_calc_123',
              currency: 'usd',
              tax_breakdown: [{
                tax_rate_details: {
                  tax_type: 'sales_tax',
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

      jest.doMock('stripe', () => jest.fn(() => mockStripe));

      await taxHandler(mockRequest, mockResponse);

      expect(mockStripe.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: expect.arrayContaining([
            expect.objectContaining({
              tax_behavior: TAX_BEHAVIOR_EXCLUSIVE
            })
          ])
        })
      );
    });

    it('should let Stripe determine behavior when no configuration is provided', async () => {
      const dummyConfig = {
        clientId: 'dummy-ctp-client-id',
        clientSecret: 'dummy-ctp-client-secret',
        projectKey: 'dummy-ctp-project-key',
        scope: 'dummy-ctp-scope',
        region: 'dummy-ctp-region',
        stripeApiToken: 'sk_test_dummy-stripe-api-token'
        // Neither taxBehaviorDefault nor countryTaxBehaviorMapping set
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
                  tax_type: 'sales_tax',
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

      // Verify that Stripe was called without tax_behavior (letting Stripe use its default behavior)
      expect(mockStripe.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: expect.arrayContaining([
            expect.not.objectContaining({
              tax_behavior: expect.anything()
            })
          ])
        })
      );
    });
  });

});
