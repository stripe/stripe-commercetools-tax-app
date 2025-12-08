import { expect, describe, it, jest, beforeEach, afterEach } from '@jest/globals';
import { ShipFromService } from '../../../src/services/ship-from.service.js';

// Mock dependencies
jest.mock('../../../src/utils/logger.utils.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../../../src/clients/create.client.js', () => ({
  createApiRoot: jest.fn()
}));

import { logger } from '../../../src/utils/logger.utils.js';
import { createApiRoot } from '../../../src/clients/create.client.js';

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
    });

    it('should resolve address from default_business (STRATEGY 3) when SHIP_FROM_REQUIRED is true', async () => {
      process.env.SHIP_FROM_REQUIRED = 'true';
      process.env.SHIP_FROM_DEFAULT_BUSINESS_COUNTRY = 'US';
      process.env.SHIP_FROM_DEFAULT_BUSINESS_STATE = 'CA';
      process.env.SHIP_FROM_DEFAULT_BUSINESS_CITY = 'San Francisco';
      process.env.SHIP_FROM_DEFAULT_BUSINESS_POSTAL_CODE = '94102';

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
      process.env.SHIP_FROM_DEFAULT_BUSINESS_COUNTRY = 'GB';
      process.env.SHIP_FROM_DEFAULT_BUSINESS_STATE = 'England';
      process.env.SHIP_FROM_DEFAULT_BUSINESS_CITY = 'London';
      process.env.SHIP_FROM_DEFAULT_BUSINESS_POSTAL_CODE = 'SW1A 1AA';
      process.env.SHIP_FROM_DEFAULT_BUSINESS_LINE1 = '10 Downing Street';
      process.env.SHIP_FROM_DEFAULT_BUSINESS_LINE2 = 'Office 1';

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
      delete process.env.SHIP_FROM_DEFAULT_BUSINESS_COUNTRY;
      delete process.env.SHIP_FROM_DEFAULT_BUSINESS_STATE;
      delete process.env.SHIP_FROM_DEFAULT_BUSINESS_CITY;
      delete process.env.SHIP_FROM_DEFAULT_BUSINESS_POSTAL_CODE;
      delete process.env.SHIP_FROM_DEFAULT_BUSINESS_LINE1;
      delete process.env.SHIP_FROM_DEFAULT_BUSINESS_LINE2;

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

    it('should return null when cache is expired', () => {
      const channelId = 'channel-expired';
      const address = { country: 'US' };

      shipFromService.saveToCache(channelId, address);
      
      // Manually expire cache by setting old timestamp
      const cache = shipFromService.channelCache;
      const cached = cache.get(channelId);
      if (cached) {
        cached.timestamp = Date.now() - (6 * 60 * 1000); // 6 minutes ago
      }

      const result = shipFromService.getFromCache(channelId);
      expect(result).toBeNull();
    });
  });

  describe('selectOptimalChannel', () => {
    it('should select channel by priority when SHIP_FROM_CHANNEL_PRIORITY is set', async () => {
      process.env.SHIP_FROM_CHANNEL_PRIORITY = 'channel-2,channel-1,channel-3';

      const entries = [
        {
          sku: 'SKU-123',
          availableQuantity: 5,
          supplyChannel: {
            id: 'channel-1',
            obj: {
              address: {
                country: 'US',
                state: 'NY',
                city: 'New York',
                postalCode: '10001'
              }
            }
          }
        },
        {
          sku: 'SKU-123',
          availableQuantity: 10,
          supplyChannel: {
            id: 'channel-2',
            obj: {
              address: {
                country: 'US',
                state: 'CA',
                city: 'Los Angeles',
                postalCode: '90001'
              }
            }
          }
        }
      ];

      const result = await shipFromService.selectOptimalChannel(entries);

      expect(result.supplyChannel.id).toBe('channel-2');
      expect(result.selectionReason).toBe('priority_based');
    });

    it('should select channel with highest stock when no priority is set', async () => {
      delete process.env.SHIP_FROM_CHANNEL_PRIORITY;

      const entries = [
        {
          sku: 'SKU-123',
          availableQuantity: 5,
          supplyChannel: {
            id: 'channel-1',
            obj: {
              address: {
                country: 'US',
                state: 'NY',
                city: 'New York',
                postalCode: '10001'
              }
            }
          }
        },
        {
          sku: 'SKU-123',
          availableQuantity: 20,
          supplyChannel: {
            id: 'channel-2',
            obj: {
              address: {
                country: 'US',
                state: 'CA',
                city: 'Los Angeles',
                postalCode: '90001'
              }
            }
          }
        },
        {
          sku: 'SKU-123',
          availableQuantity: 10,
          supplyChannel: {
            id: 'channel-3',
            obj: {
              address: {
                country: 'US',
                state: 'TX',
                city: 'Austin',
                postalCode: '78701'
              }
            }
          }
        }
      ];

      const result = await shipFromService.selectOptimalChannel(entries);

      expect(result.supplyChannel.id).toBe('channel-2');
      expect(result.selectionReason).toBe('highest_stock');
      expect(result.availableQuantity).toBe(20);
    });

    it('should handle empty priority configuration', async () => {
      process.env.SHIP_FROM_CHANNEL_PRIORITY = '';

      const entries = [
        {
          sku: 'SKU-123',
          availableQuantity: 10,
          supplyChannel: {
            id: 'channel-1',
            obj: {
              address: {
                country: 'US',
                state: 'NY',
                city: 'New York',
                postalCode: '10001'
              }
            }
          }
        }
      ];

      const result = await shipFromService.selectOptimalChannel(entries);

      expect(result.selectionReason).toBe('highest_stock');
    });
  });

  describe('getAddressFromInventory - edge cases', () => {
    it('should filter out entries with no stock', async () => {
      const sku = 'SKU-NO-STOCK';
      const mockInventory = {
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          body: {
            results: [
              {
                sku: sku,
                availableQuantity: 0,
                supplyChannel: {
                  id: 'channel-1',
                  obj: {
                    address: {
                      country: 'US',
                      state: 'NY',
                      city: 'New York',
                      postalCode: '10001'
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

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'No inventory entries with valid addresses found',
        { sku }
      );
    });

    it('should handle inventory entries without supplyChannel.obj', async () => {
      const sku = 'SKU-NO-OBJ';
      const mockInventory = {
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          body: {
            results: [
              {
                sku: sku,
                availableQuantity: 10,
                supplyChannel: {
                  id: 'channel-1'
                  // No obj property
                }
              }
            ]
          }
        })
      };

      mockApiRoot.inventory.mockReturnValue(mockInventory);

      const result = await shipFromService.getAddressFromInventory(sku);

      expect(result).toBeNull();
    });
  });

  describe('resolveShipFromForLineItem - error handling', () => {
    it('should throw error when SHIP_FROM_REQUIRED is true and resolution fails', async () => {
      process.env.SHIP_FROM_REQUIRED = 'true';

      const lineItem = {
        id: 'line-item-error',
        variant: { sku: 'SKU-ERROR' }
      };

      // Mock getAddressFromInventory to throw error
      const originalGetAddressFromInventory = shipFromService.getAddressFromInventory;
      shipFromService.getAddressFromInventory = jest.fn().mockRejectedValue(new Error('API Error'));

      await expect(shipFromService.resolveShipFromForLineItem(lineItem)).rejects.toThrow('API Error');

      // Restore original method
      shipFromService.getAddressFromInventory = originalGetAddressFromInventory;
    });

    it('should handle error when channel fetch fails in strategy 1', async () => {
      const lineItem = {
        id: 'line-item-1',
        supplyChannel: { id: 'channel-error' },
        variant: { sku: 'SKU-123' }
      };

      const mockChannel = {
        withId: jest.fn().mockReturnThis(),
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(new Error('Channel fetch failed'))
      };

      mockApiRoot.channels.mockReturnValue(mockChannel);

      // Should fallback to strategy 2 (inventory)
      const mockInventory = {
        get: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          body: {
            results: [
              {
                sku: 'SKU-123',
                availableQuantity: 10,
                supplyChannel: {
                  id: 'channel-2',
                  obj: {
                    address: {
                      country: 'US',
                      state: 'CA',
                      city: 'San Francisco',
                      postalCode: '94102'
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

      expect(result.source).toBe('inventory.supplyChannel');
    });
  });

  describe('getChannelPriority', () => {
    it('should return empty array when SHIP_FROM_CHANNEL_PRIORITY is not set', () => {
      delete process.env.SHIP_FROM_CHANNEL_PRIORITY;

      const result = shipFromService.getChannelPriority();

      expect(result).toEqual([]);
    });

    it('should parse SHIP_FROM_CHANNEL_PRIORITY with spaces', () => {
      process.env.SHIP_FROM_CHANNEL_PRIORITY = 'channel-1, channel-2 , channel-3';

      const result = shipFromService.getChannelPriority();

      expect(result).toEqual(['channel-1', 'channel-2', 'channel-3']);
    });
  });
});

