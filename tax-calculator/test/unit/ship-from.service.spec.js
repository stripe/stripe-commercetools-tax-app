import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import { ShipFromService } from '../../src/services/ship-from.service.js';

// Mock dependencies
jest.mock('../../src/utils/logger.utils.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../../src/clients/create.client.js', () => ({
  createApiRoot: jest.fn()
}));

import { logger } from '../../src/utils/logger.utils.js';
import { createApiRoot } from '../../src/clients/create.client.js';

describe('ShipFromService', () => {
  let shipFromService;
  let mockApiRoot;
  let originalEnv;

  beforeEach(() => {
    shipFromService = new ShipFromService();
    originalEnv = { ...process.env };
    
    // Mock API root structure
    mockApiRoot = {
      channels: jest.fn().mockReturnThis(),
      inventory: jest.fn().mockReturnThis()
    };
    
    createApiRoot.mockReturnValue(mockApiRoot);
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    shipFromService.clearCache();
  });

  describe('resolveShipFromForLineItem', () => {
    it('should resolve address from lineItem.supplyChannel (STRATEGY 1)', async () => {
      const lineItem = {
        id: 'line-item-1',
        supplyChannel: { id: 'channel-1' },
        variant: { sku: 'SKU-123' }
      };

      const mockChannel = {
        withId: jest.fn().mockReturnThis(),
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          body: {
            id: 'channel-1',
            address: {
              country: 'US',
              state: 'NY',
              city: 'New York',
              postalCode: '10001',
              streetName: '123 Main St',
              streetNumber: 'Apt 4'
            }
          }
        })
      };

      mockApiRoot.channels.mockReturnValue(mockChannel);

      const result = await shipFromService.resolveShipFromForLineItem(lineItem);

      expect(result).toEqual({
        address: {
          country: 'US',
          state: 'NY',
          city: 'New York',
          postal_code: '10001',
          line1: '123 Main St',
          line2: 'Apt 4'
        },
        source: 'lineItem.supplyChannel'
      });
      expect(logger.info).toHaveBeenCalledWith(
        'Ship-from resolved: lineItem.supplyChannel',
        expect.objectContaining({
          lineItemId: 'line-item-1',
          channelId: 'channel-1'
        })
      );
    });

    it('should resolve address from inventory.supplyChannel (STRATEGY 2)', async () => {
      const lineItem = {
        id: 'line-item-2',
        variant: { sku: 'SKU-456' }
      };

      const mockInventory = {
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          body: {
            results: [
              {
                sku: 'SKU-456',
                availableQuantity: 10,
                supplyChannel: {
                  id: 'channel-2',
                  obj: {
                    id: 'channel-2',
                    address: {
                      country: 'CA',
                      state: 'ON',
                      city: 'Toronto',
                      postalCode: 'M5H 2N2',
                      streetName: '456 Bay St'
                    }
                  }
                }
              }
            ]
          }
        })
      };

      mockApiRoot.inventory.mockReturnValue(mockInventory);

      const result = await shipFromService.resolveShipFromForLineItem(lineItem);

      expect(result).toEqual({
        address: {
          country: 'CA',
          state: 'ON',
          city: 'Toronto',
          postal_code: 'M5H 2N2',
          line1: '456 Bay St',
          line2: undefined
        },
        source: 'inventory.supplyChannel'
      });
      expect(logger.info).toHaveBeenCalledWith(
        'Ship-from resolved: inventory.supplyChannel',
        expect.objectContaining({
          lineItemId: 'line-item-2',
          sku: 'SKU-456'
        })
      );
    });

    it('should resolve address from default_business (STRATEGY 3) when SHIP_FROM_REQUIRED is true', async () => {
      process.env.SHIP_FROM_REQUIRED = 'true';
      process.env.DEFAULT_BUSINESS_COUNTRY = 'US';
      process.env.DEFAULT_BUSINESS_STATE = 'CA';
      process.env.DEFAULT_BUSINESS_CITY = 'San Francisco';
      process.env.DEFAULT_BUSINESS_POSTAL_CODE = '94102';

      const lineItem = {
        id: 'line-item-3',
        variant: { sku: 'SKU-789' }
      };

      const result = await shipFromService.resolveShipFromForLineItem(lineItem);

      expect(result).toEqual({
        address: {
          country: 'US',
          state: 'CA',
          city: 'San Francisco',
          postal_code: '94102',
          line1: '',
          line2: ''
        },
        source: 'default_business'
      });
      expect(logger.info).toHaveBeenCalledWith(
        'Ship-from resolved: default_business',
        expect.objectContaining({
          lineItemId: 'line-item-3'
        })
      );
    });

    it('should return not_required when SHIP_FROM_REQUIRED is not true', async () => {
      process.env.SHIP_FROM_REQUIRED = 'false';

      const lineItem = {
        id: 'line-item-4',
        variant: { sku: 'SKU-999' }
      };

      const result = await shipFromService.resolveShipFromForLineItem(lineItem);

      expect(result).toEqual({
        address: null,
        source: 'not_required'
      });
      expect(logger.info).toHaveBeenCalledWith(
        'Ship-from not resolved (optional mode)',
        expect.objectContaining({
          lineItemId: 'line-item-4'
        })
      );
    });

    it('should handle errors gracefully when ship-from is optional', async () => {
      process.env.SHIP_FROM_REQUIRED = 'false';

      const lineItem = {
        id: 'line-item-5',
        variant: { sku: 'SKU-ERROR' }
      };

      // Mock getAddressFromInventory to throw an error that reaches the catch block
      const originalGetAddressFromInventory = shipFromService.getAddressFromInventory;
      shipFromService.getAddressFromInventory = jest.fn().mockRejectedValue(new Error('API Error'));

      const result = await shipFromService.resolveShipFromForLineItem(lineItem);

      expect(result).toEqual({
        address: null,
        source: 'error_fallback'
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Error resolving ship-from address',
        expect.objectContaining({
          error: 'API Error',
          lineItemId: 'line-item-5'
        })
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Ship-from resolution failed but is optional, continuing without ship-from',
        expect.objectContaining({
          lineItemId: 'line-item-5',
          error: 'API Error'
        })
      );

      // Restore original method
      shipFromService.getAddressFromInventory = originalGetAddressFromInventory;
    });
  });

  describe('getAddressFromChannelId', () => {
    it('should fetch and format address from channel', async () => {
      const channelId = 'channel-1';
      const mockChannel = {
        withId: jest.fn().mockReturnThis(),
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          body: {
            id: channelId,
            address: {
              country: 'US',
              state: 'TX',
              city: 'Austin',
              postalCode: '78701',
              streetName: '100 Congress Ave'
            }
          }
        })
      };

      mockApiRoot.channels.mockReturnValue(mockChannel);

      const result = await shipFromService.getAddressFromChannelId(channelId);

      expect(result).toEqual({
        country: 'US',
        state: 'TX',
        city: 'Austin',
        postal_code: '78701',
        line1: '100 Congress Ave',
        line2: undefined
      });
      expect(mockChannel.withId).toHaveBeenCalledWith({ ID: channelId });
    });

    it('should return null when channel has no address', async () => {
      const channelId = 'channel-no-address';
      const mockChannel = {
        withId: jest.fn().mockReturnThis(),
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          body: {
            id: channelId
          }
        })
      };

      mockApiRoot.channels.mockReturnValue(mockChannel);

      const result = await shipFromService.getAddressFromChannelId(channelId);

      expect(result).toBeNull();
    });

    it('should use cache when address is already cached', async () => {
      const channelId = 'channel-cached';
      const cachedAddress = {
        country: 'US',
        state: 'FL',
        city: 'Miami',
        postal_code: '33101'
      };

      shipFromService.saveToCache(channelId, cachedAddress);

      const result = await shipFromService.getAddressFromChannelId(channelId);

      expect(result).toEqual(cachedAddress);
      expect(mockApiRoot.channels).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'Channel address retrieved from cache',
        { channelId }
      );
    });

    it('should handle API errors gracefully', async () => {
      const channelId = 'channel-error';
      const mockChannel = {
        withId: jest.fn().mockReturnThis(),
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(new Error('Channel not found'))
      };

      mockApiRoot.channels.mockReturnValue(mockChannel);

      const result = await shipFromService.getAddressFromChannelId(channelId);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Error fetching channel',
        expect.objectContaining({
          error: 'Channel not found',
          channelId
        })
      );
    });
  });

  describe('getAddressFromInventory', () => {
    it('should select optimal channel from inventory entries', async () => {
      const sku = 'SKU-123';
      const mockInventory = {
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          body: {
            results: [
              {
                sku: sku,
                availableQuantity: 5,
                supplyChannel: {
                  id: 'channel-1',
                  obj: {
                    address: {
                      country: 'US',
                      state: 'WA',
                      city: 'Seattle',
                      postalCode: '98101',
                      streetName: '200 1st Ave'
                    }
                  }
                }
              }
            ]
          }
        })
      };

      mockApiRoot.inventory.mockReturnValue(mockInventory);

      const result = await shipFromService.getAddressFromInventory(sku);

      expect(result).toEqual({
        country: 'US',
        state: 'WA',
        city: 'Seattle',
        postal_code: '98101',
        line1: '200 1st Ave',
        line2: undefined
      });
    });

    it('should return null when no inventory entries with addresses found', async () => {
      const sku = 'SKU-NO-ADDRESS';
      const mockInventory = {
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          body: {
            results: [
              {
                sku: sku,
                availableQuantity: 10,
                supplyChannel: {
                  id: 'channel-1',
                  obj: {}
                }
              }
            ]
          }
        })
      };

      mockApiRoot.inventory.mockReturnValue(mockInventory);

      const result = await shipFromService.getAddressFromInventory(sku);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'No inventory entries with valid addresses found',
        { sku }
      );
    });
  });

  describe('getDefaultBusinessAddress', () => {
    it('should return default address from environment variables', () => {
      process.env.DEFAULT_BUSINESS_COUNTRY = 'GB';
      process.env.DEFAULT_BUSINESS_STATE = 'England';
      process.env.DEFAULT_BUSINESS_CITY = 'London';
      process.env.DEFAULT_BUSINESS_POSTAL_CODE = 'SW1A 1AA';
      process.env.DEFAULT_BUSINESS_LINE1 = '10 Downing Street';
      process.env.DEFAULT_BUSINESS_LINE2 = 'Office 1';

      const result = shipFromService.getDefaultBusinessAddress();

      expect(result).toEqual({
        country: 'GB',
        state: 'England',
        city: 'London',
        postal_code: 'SW1A 1AA',
        line1: '10 Downing Street',
        line2: 'Office 1'
      });
    });

    it('should return default values when environment variables are not set', () => {
      delete process.env.DEFAULT_BUSINESS_COUNTRY;
      delete process.env.DEFAULT_BUSINESS_STATE;
      delete process.env.DEFAULT_BUSINESS_CITY;
      delete process.env.DEFAULT_BUSINESS_POSTAL_CODE;
      delete process.env.DEFAULT_BUSINESS_LINE1;
      delete process.env.DEFAULT_BUSINESS_LINE2;

      const result = shipFromService.getDefaultBusinessAddress();

      expect(result).toEqual({
        country: 'US',
        state: 'NY',
        city: 'New York',
        postal_code: '10001',
        line1: '',
        line2: ''
      });
    });
  });

  describe('formatAddressForStripe', () => {
    it('should format commercetools address to Stripe format', () => {
      const ctAddress = {
        country: 'US',
        state: 'CA',
        city: 'Los Angeles',
        postalCode: '90001',
        streetName: '123 Main St',
        streetNumber: 'Suite 100'
      };

      const result = shipFromService.formatAddressForStripe(ctAddress);

      expect(result).toEqual({
        country: 'US',
        state: 'CA',
        city: 'Los Angeles',
        postal_code: '90001',
        line1: '123 Main St',
        line2: 'Suite 100'
      });
    });

    it('should handle address with postal_code instead of postalCode', () => {
      const ctAddress = {
        country: 'US',
        state: 'NY',
        city: 'New York',
        postal_code: '10001',
        line1: '456 Broadway'
      };

      const result = shipFromService.formatAddressForStripe(ctAddress);

      expect(result).toEqual({
        country: 'US',
        state: 'NY',
        city: 'New York',
        postal_code: '10001',
        line1: '456 Broadway',
        line2: undefined
      });
    });
  });

  describe('resolveAllShipFromAddresses', () => {
    it('should resolve addresses for all line items in parallel', async () => {
      const lineItems = [
        {
          id: 'line-item-1',
          supplyChannel: { id: 'channel-1' }
        },
        {
          id: 'line-item-2',
          variant: { sku: 'SKU-2' }
        }
      ];

      const mockChannel = {
        withId: jest.fn().mockReturnThis(),
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          body: {
            id: 'channel-1',
            address: {
              country: 'US',
              state: 'NY',
              city: 'New York',
              postalCode: '10001',
              streetName: '123 Main St'
            }
          }
        })
      };

      const mockInventory = {
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          body: {
            results: [
              {
                sku: 'SKU-2',
                availableQuantity: 10,
                supplyChannel: {
                  id: 'channel-2',
                  obj: {
                    address: {
                      country: 'CA',
                      state: 'ON',
                      city: 'Toronto',
                      postalCode: 'M5H 2N2',
                      streetName: '456 Bay St'
                    }
                  }
                }
              }
            ]
          }
        })
      };

      mockApiRoot.channels.mockReturnValue(mockChannel);
      mockApiRoot.inventory.mockReturnValue(mockInventory);

      const results = await shipFromService.resolveAllShipFromAddresses(lineItems);

      expect(results).toHaveLength(2);
      expect(results[0].source).toBe('lineItem.supplyChannel');
      expect(results[1].source).toBe('inventory.supplyChannel');
    });
  });

  describe('cache management', () => {
    it('should cache addresses and retrieve from cache', () => {
      const channelId = 'channel-cache-test';
      const address = {
        country: 'US',
        state: 'TX',
        city: 'Dallas',
        postal_code: '75201'
      };

      shipFromService.saveToCache(channelId, address);
      const cached = shipFromService.getFromCache(channelId);

      expect(cached).toEqual(address);
    });

    it('should clear cache', () => {
      const channelId = 'channel-clear-test';
      const address = { country: 'US' };

      shipFromService.saveToCache(channelId, address);
      shipFromService.clearCache();
      const cached = shipFromService.getFromCache(channelId);

      expect(cached).toBeNull();
    });
  });
});

