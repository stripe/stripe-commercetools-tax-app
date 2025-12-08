import { logger } from '../utils/logger.utils.js';
import { createApiRoot } from '../clients/create.client.js';

/**
 * Ship From Service
 * Provides methods to resolve ship-from addresses for line items using fallback strategies 
 * 1. Line Item supply channel (highest priority) - Uses commercetools Channel API
 * 2. Inventory Entry supply channel (dropshipping case) - Uses commercetools Inventory API
 * 3. Default business address (lowest priority) - Uses environment variables
 * 
 */
class ShipFromService {
  constructor() {
    this.channelCache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Resolve ship-from addresses for all line items in parallel
   * @param {Array} lineItems - Array of line items
   * @returns {Promise<Array>} Array of ship-from info objects
   */
  async resolveAllShipFromAddresses(lineItems) {
    const promises = lineItems.map(lineItem => 
      this.resolveShipFromForLineItem(lineItem)
    );
    
    return Promise.all(promises);
  }

  /**
   * Resolve ship-from address for a line item using fallback strategies
   * @param {Object} lineItem - commercetools cart line item
   * @returns {Promise<Object>} Ship-from address with source information
   */
  async resolveShipFromForLineItem(lineItem) {
    try {
      // STRATEGY 1: Line Item supplyChannel (HIGHEST PRIORITY)
      if (lineItem.supplyChannel?.id) {
        const address = await this.getAddressFromChannelId(lineItem.supplyChannel.id);
        if (address) {
          return { address, source: 'lineItem.supplyChannel' };
        }
      }

      // STRATEGY 2: Inventory Entry supplyChannel (dropshipping case)
      if (lineItem.variant?.sku) {
        const address = await this.getAddressFromInventory(lineItem.variant.sku);
        if (address) {
          return { address, source: 'inventory.supplyChannel' };
        }
      }

      // STRATEGY 3: Default business address (LOWEST PRIORITY)
      // Only use default if SHIP_FROM_REQUIRED is 'true'
      // For digital products or when ship-from is optional, return null
      if (process.env.SHIP_FROM_REQUIRED === 'true') {
        const defaultAddress = this.getDefaultBusinessAddress();
        return { address: defaultAddress, source: 'default_business' };
      }

      // Ship-from is optional, return null for digital products or when not required
      return { address: null, source: 'not_required' };

    } catch (error) {
      logger.error('Error resolving ship-from address', {
        error: error.message,
        lineItemId: lineItem.id
      });
      // If ship-from is optional, don't throw error, return null instead
      if (process.env.SHIP_FROM_REQUIRED !== 'true') {
        logger.warn('Ship-from resolution failed but is optional, continuing without ship-from', {
          lineItemId: lineItem.id,
          error: error.message
        });
        return { address: null, source: 'error_fallback' };
      }
      throw error;
    }
  }

  /**
   * Get address from commercetools Channel
   * @param {string} channelId - Channel ID
   * @returns {Promise<Object|null>} Stripe-formatted address or null
   */
  async getAddressFromChannelId(channelId) {
    // Check cache first
    const cachedAddress = this.getFromCache(channelId);
    if (cachedAddress) {
      return cachedAddress;
    }

    try {
      const apiRoot = createApiRoot();
      const channel = await apiRoot
        .channels()
        .withId({ ID: channelId })
        .get()
        .execute();

      if (channel.body?.address) {
        const address = this.formatAddressForStripe(channel.body.address);
        
        // Save to cache
        this.saveToCache(channelId, address);
        
        return address;
      }
      return null;
    } catch (error) {
      logger.warn('Error fetching channel', { error: error.message, channelId });
      return null;
    }
  }

  /**
   * Get address from Inventory Entry with intelligent channel selection
   * @param {string} sku - Product SKU
   * @returns {Promise<Object|null>} Stripe-formatted address or null
   */
  async getAddressFromInventory(sku) {
    try {
      const apiRoot = createApiRoot();
      const inventoryResponse = await apiRoot
        .inventory()
        .get({
          queryArgs: {
            where: `sku="${sku}"`,
            expand: 'supplyChannel'
          }
        })
        .execute();

      const results = inventoryResponse.body?.results || [];
      
      // Filter entries with valid addresses and stock
      const entriesWithAddress = results.filter(entry => 
        entry.supplyChannel?.obj?.address && entry.availableQuantity > 0
      );
      
      if (entriesWithAddress.length === 0) {
        logger.warn('No inventory entries with valid addresses found', { sku });
        return null;
      }
      
      // Intelligent channel selection with multiple strategies
      const selectedEntry = await this.selectOptimalChannel(entriesWithAddress);
      
      if (selectedEntry?.supplyChannel?.obj?.address) {
        logger.info('Selected optimal supply channel', {
          sku,
          channelId: selectedEntry.supplyChannel.id,
          selectionReason: selectedEntry.selectionReason,
          availableQuantity: selectedEntry.availableQuantity
        });
        return this.formatAddressForStripe(selectedEntry.supplyChannel.obj.address);
      }
      
      return null;
    } catch (error) {
      logger.warn('Error fetching inventory', { error: error.message, sku });
      return null;
    }
  }

  /**
   * Select optimal channel using multiple strategies
   * @param {Array} entries - Inventory entries with valid addresses
   * @returns {Promise<Object>} Selected entry with selection reason
   */
  async selectOptimalChannel(entries) {
    // Strategy 1: Priority-based selection (highest priority)
    const prioritizedEntry = this.selectByPriority(entries);
    if (prioritizedEntry) {
      return { ...prioritizedEntry, selectionReason: 'priority_based' };
    }
  
    
    // Strategy 2: Stock-based selection (highest available quantity)
    const bestStockEntry = entries.reduce((best, current) => 
      current.availableQuantity > best.availableQuantity ? current : best
    );
    
    return { ...bestStockEntry, selectionReason: 'highest_stock' };
  }

  /**
   * Select channel by configured priority
   * @param {Array} entries - Inventory entries
   * @returns {Object|null} Selected entry or null
   */
  selectByPriority(entries) {
    const prioritizedChannels = this.getChannelPriority();
    
    for (const channelId of prioritizedChannels) {
      const entry = entries.find(e => e.supplyChannel?.id === channelId);
      if (entry) {
        logger.info('Selected channel by priority', {
          channelId,
          priority: prioritizedChannels.indexOf(channelId) + 1
        });
        return entry;
      }
    }
    
    return null;
  }


  /**
   * Get channel priority configuration
   * @returns {Array} Array of channel IDs in priority order
   */
  getChannelPriority() {
    const priorityConfig = process.env.SHIP_FROM_CHANNEL_PRIORITY;
    
    if (priorityConfig) {
      return priorityConfig.split(',').map(id => id.trim());
    }
    
    return [];
  }

  /**
   * Get default business address
   * @returns {Object} Stripe-formatted address
   */
  getDefaultBusinessAddress() {
    return {
      country: process.env.SHIP_FROM_DEFAULT_BUSINESS_COUNTRY || 'US',
      state: process.env.SHIP_FROM_DEFAULT_BUSINESS_STATE || 'NY',
      city: process.env.SHIP_FROM_DEFAULT_BUSINESS_CITY || 'New York',
      postal_code: process.env.SHIP_FROM_DEFAULT_BUSINESS_POSTAL_CODE || '10001',
      line1: process.env.SHIP_FROM_DEFAULT_BUSINESS_LINE1 || '',
      line2: process.env.SHIP_FROM_DEFAULT_BUSINESS_LINE2 || ''
    };
  }

  /**
   * Format commercetools address to Stripe format
   * @param {Object} address - commercetools address
   * @returns {Object} Stripe-formatted address
   */
  formatAddressForStripe(address) {
    return {
      country: address.country,
      state: address.state,
      city: address.city,
      postal_code: address.postalCode || address.postal_code,
      line1: address.streetName || address.line1,
      line2: address.streetNumber || address.line2
    };
  }

  /**
   * Gets address from cache
   * @param {string} channelId - Channel ID
   * @returns {Object|null} Cached address or null
   * @private
   */
  getFromCache(channelId) {
    const cached = this.channelCache.get(channelId);

    if (!cached) {
      return null;
    }

    // Check if the cache is valid (not expired)
    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.channelCache.delete(channelId);
      return null;
    }

    return cached.address;
  }

  /**
   * Saves address to cache
   * @param {string} channelId - Channel ID
   * @param {Object} address - Stripe-formatted address
   * @private
   */
  saveToCache(channelId, address) {
    this.channelCache.set(channelId, {
      address: address,
      timestamp: Date.now()
    });
  }

  /**
   * Clears the cache (useful for testing or when you need to force refresh)
   */
  clearCache() {
    this.channelCache.clear();
    logger.debug('Cache cleared');
  }
}

// Singleton instance
const shipFromService = new ShipFromService();

export default shipFromService;
export { ShipFromService };