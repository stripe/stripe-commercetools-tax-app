import { expect, describe, it, jest, beforeEach } from '@jest/globals';

// Mock dependencies
jest.mock('../../../src/utils/config.util.js', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import readConfiguration from '../../../src/utils/config.util.js';
import { getHttpMiddlewareOptions } from '../../../src/middlewares/http.middleware.js';

describe('http.middleware.spec', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getHttpMiddlewareOptions', () => {
    it('should return http middleware options with correct host', () => {
      readConfiguration.mockReturnValue({
        region: 'us-central1.gcp',
      });

      const result = getHttpMiddlewareOptions();

      expect(readConfiguration).toHaveBeenCalled();
      expect(result).toEqual({
        host: 'https://api.us-central1.gcp.commercetools.com',
      });
    });

    it('should handle different regions correctly', () => {
      const regions = [
        'us-central1.gcp',
        'us-east-2.aws',
        'europe-west1.gcp',
        'eu-central-1.aws',
        'australia-southeast1.gcp',
      ];

      regions.forEach((region) => {
        readConfiguration.mockReturnValue({
          region: region,
        });

        const result = getHttpMiddlewareOptions();

        expect(result.host).toBe(`https://api.${region}.commercetools.com`);
      });
    });

    it('should call readConfiguration to get region', () => {
      readConfiguration.mockReturnValue({
        region: 'europe-west1.gcp',
      });

      getHttpMiddlewareOptions();

      expect(readConfiguration).toHaveBeenCalled();
    });
  });
});

