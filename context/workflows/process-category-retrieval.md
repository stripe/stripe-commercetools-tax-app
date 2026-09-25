# Process Category Retrieval

## Description

The process of category retrieval is a high-performance data fetching mechanism implemented in the category service. This system efficiently retrieves expanded product categories from the commercetools API using Product Projections, with intelligent caching and batch processing to optimize performance for large product catalogs.

The process is designed to handle e-commerce scenarios where products belong to multiple categories, and category information (including custom types) must be retrieved efficiently for tax code resolution and other business logic. The solution uses Product Projections API with category expansion, implements in-memory caching with partial cache support, and handles large product sets through batch processing.

**Main Flow**: The system receives an array of product IDs, validates and deduplicates them, checks cache for existing data, fetches missing products from the commercetools API in batches if needed, merges cached and fetched results, updates the cache, and returns a Map of product IDs to their expanded category arrays.

## Problem

E-commerce platforms require efficient category retrieval for multiple products:

- Products can belong to multiple categories simultaneously
- Categories contain custom type fields (e.g., tax codes) that must be retrieved
- Tax calculation requires category information for all products in a cart
- commercetools API has limits (500 products per query)
- Repeated API calls for the same products waste resources
- Different products may need different locale or staged versions

The main challenges addressed by this solution include:

1. **Batch Processing**: commercetools API limits queries to 500 products, requiring batch processing for larger sets.

2. **Performance Optimization**: Repeated API calls for the same products waste resources and slow down tax calculations.

3. **Partial Cache Support**: When some products are cached and others are not, the system should use cached data and only fetch missing products.

4. **Category Expansion**: Categories must be expanded with their custom types to access tax codes and other metadata.

5. **Concurrent Batch Execution**: Multiple batches should be executed concurrently with limits to optimize throughput without overwhelming the API.

6. **Error Resilience**: Individual batch failures should not prevent successful batches from being processed.

## Solution Found

The solution implements a multi-layered optimization algorithm that:

1. **Validates and deduplicates**: Removes duplicate and null product IDs
2. **Checks cache**: Uses in-memory cache with 5-minute TTL to avoid API calls
3. **Supports partial cache**: Uses cached products and only fetches missing ones
4. **Batch processing**: Divides large product sets into batches of 500 (commercetools limit)
5. **Concurrent execution**: Executes multiple batches in parallel with concurrency limits
6. **Error resilience**: Uses `Promise.allSettled()` to handle batch failures gracefully
7. **Category expansion**: Expands categories with custom types in a single API call
8. **Cache management**: Updates cache with merged results for future requests

### Key Features

- **Intelligent Caching**: In-memory cache with 5-minute TTL, supports partial cache hits
- **Batch Processing**: Automatically handles products exceeding commercetools 500 limit
- **Concurrent Execution**: Executes up to 5 batches concurrently for optimal throughput
- **Partial Cache Support**: Uses cached data and only fetches missing products
- **Category Expansion**: Expands categories with custom types in single API call
- **Error Resilience**: Individual batch failures don't prevent successful batches
- **Comprehensive Logging**: Detailed audit trail for cache hits, API calls, and batch processing

## Solution Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│              Tax Orchestrator Service                            │
│         orchestrateTaxCalculation(cart)                          │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: Extract Product IDs                                    │
│  productIds = cart.lineItems.map(item => item.productId)        │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Get Categories for Products                            │
│  categoryService.getCategoriesForProducts(productIds, options)   │
│                                                                   │
│  - Validate and deduplicate product IDs                          │
│  - Check cache (if enabled)                                       │
│  - Determine which products need fetching                        │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            │ Cache Enabled?        │ No Cache
            │ Yes                   │
            │                       │
            ▼                       ▼
┌───────────────────────┐   ┌───────────────────────┐
│ Check Cache           │   │ Fetch All Products    │
│ getFromCache()        │   │ from API              │
│                        │   │                       │
│ - Get cache entry      │   │                       │
│ - Check TTL            │   │                       │
│ - Filter by productIds │   │                       │
└───────────┬───────────┘   └───────────┬───────────┘
            │                           │
            │                           │
    ┌───────┴────────┐                  │
    │                │                  │
    │ Full Cache Hit?│ Partial/Miss    │
    │ Yes → RETURN   │ Continue        │
    │                │                  │
    └────────────────┴──────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: Fetch Missing Products from API                        │
│  fetchCategoriesFromAPI(productIdsToFetch, options)             │
│                                                                   │
│  - Check if > 500 products (batch needed)                        │
│  - Build WHERE predicate: id in ("id1", "id2", ...)              │
│  - Query Product Projections API                                │
│  - Expand: categories[*]                                        │
│  - Extract categories from projections                           │
└───────────────────────┬─────────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            │ > 500 products?       │ ≤ 500 products
            │ Yes → Batch Process   │ Single Query
            │                       │
            ▼                       ▼
┌───────────────────────┐   ┌───────────────────────┐
│ fetchCategoriesInBatches│   │ Single API Query      │
│                        │   │                       │
│ - Divide into batches  │   │ - Build WHERE clause  │
│   of 500              │   │ - Execute query       │
│ - Execute up to 5     │   │ - Extract categories  │
│   batches concurrently│   │ - Return Map          │
│ - Combine results     │   │                       │
└───────────┬───────────┘   └───────────┬───────────┘
            │                           │
            └───────────┬───────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: Merge Results                                          │
│  Merge cached and fetched results                               │
│                                                                   │
│  - Combine cached categories with fetched categories             │
│  - Create unified Map<productId, categories[]>                  │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5: Update Cache                                            │
│  saveToCache(categoriesMap, staged, locale)                      │
│                                                                   │
│  - Generate cache key: categories_{staged}_{locale}              │
│  - Store Map with timestamp                                      │
│  - Cache TTL: 5 minutes                                         │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
                ┌───────────────┐
                │ Return Map     │
                │ <productId,    │
                │  categories[]> │
                └───────────────┘
```

## Step-by-Step Solution Description

### Overview Flow

1. **Input Validation**: Validates and deduplicates product IDs
2. **Cache Check**: Checks in-memory cache for existing category data
3. **Partial Cache Support**: Uses cached products and identifies missing ones
4. **API Fetching**: Fetches missing products from commercetools API
5. **Batch Processing**: Divides large sets into batches and processes concurrently
6. **Result Merging**: Combines cached and fetched results
7. **Cache Update**: Updates cache with merged results
8. **Return**: Returns Map of product IDs to category arrays

### Detailed Steps

#### Step 1: Entry Point - Get Categories for Products

**Method**: `CategoryService.getCategoriesForProducts(productIds, options)`

**Parameters**:
- `productIds`: Array of product ID strings
- `options`: Optional configuration object
  - `staged`: Boolean (default: false) - Use staged or current version
  - `locale`: String (optional) - Locale for projections
  - `useCache`: Boolean (default: true) - Enable/disable caching

**Process**:

1. **Input Validation**:
   - Returns empty Map if `productIds` is null, undefined, or empty array
   - Filters out null/undefined IDs: `productIds.filter(Boolean)`
   - Removes duplicates: `[...new Set(filteredIds)]`
   - Returns empty Map if no valid IDs remain

2. **Options Processing**:
   - Extracts `staged` (default: false), `locale` (optional), `useCache` (default: true)
   - Logs request with total products, staged flag, locale, and cache setting

3. **Cache Check** (if enabled):
   - Calls `getFromCache(uniqueProductIds, staged, locale)`
   - If full cache hit (all products cached), returns immediately
   - If partial cache hit, uses cached products and identifies missing ones
   - If cache miss, proceeds to fetch all products

4. **API Fetching** (for missing products):
   - Calls `fetchCategoriesFromAPI(productIdsToFetch, options)`
   - Only fetches products not in cache (if partial cache hit)

5. **Result Merging**:
   - Merges cached categories with fetched categories
   - Creates unified Map: `Map<productId, categories[]>`

6. **Cache Update** (if enabled):
   - Calls `saveToCache(categoriesMap, staged, locale)`
   - Updates cache with merged results for future requests

7. **Return**:
   - Returns `Map<string, Array<Category>>` with all product categories

**Code Example**:
```javascript
const categoriesMap = await categoryService.getCategoriesForProducts(
  productIds,
  {
    staged: false,
    locale: 'en',
    useCache: true
  }
);
// Result: Map { "product-1" => [category1, category2], "product-2" => [category3] }
```

#### Step 2: Fetch Categories from API

**Method**: `CategoryService.fetchCategoriesFromAPI(productIds, options)` (private)

**Process**:

1. **Batch Check**:
   - If `productIds.length > 500`, calls `fetchCategoriesInBatches()`
   - Otherwise, proceeds with single query

2. **WHERE Predicate Construction**:
   - Builds predicate: `id in ("id1", "id2", ..., "idN")`
   - Escapes product IDs with quotes: `productIds.map(id => \`"${id}"\`).join(', ')`

3. **Query Arguments**:
   - `where`: WHERE predicate string
   - `staged`: Staged flag (boolean)
   - `expand`: `['categories[*]']` — Expands the category references on each product. Note: parent and `custom` sub-paths are NOT expanded (the active `tax-code.service.js` flow does not need them).
   - `limit`: 500 (commercetools maximum)
   - `locale`: Optional locale string (only included when provided)

4. **API Query Execution**:
   - Calls `createApiRoot().productProjections().get({ queryArgs }).execute()`
   - Extracts results: `response.body.results || []`

5. **Category Extraction**:
   - For each Product Projection, calls `extractCategories(projection)`
   - Creates Map: `Map<productId, categories[]>`

6. **Logging**:
   - Logs requested count, fetched count, and failed count

7. **Return**:
   - Returns `Map<string, Array<Category>>`

**API Query Example**:
```javascript
const queryArgs = {
  where: 'id in ("product-1", "product-2", "product-3")',
  staged: false,
  expand: ['categories[*]'],
  limit: 500,
  locale: 'en'
};
```

#### Step 3: Fetch Categories in Batches

**Method**: `CategoryService.fetchCategoriesInBatches(productIds, options)` (private)

**Process**:

1. **Batch Division**:
   - Divides product IDs into batches of 500 (BATCH_SIZE)
   - Creates array of batches: `[[id1...id500], [id501...id1000], ...]`

2. **Concurrency Control**:
   - Processes up to 5 batches concurrently (MAX_CONCURRENT_BATCHES)
   - Groups batches: `batches.slice(i, i + MAX_CONCURRENT_BATCHES)`

3. **Parallel Execution**:
   - Uses `Promise.allSettled()` to execute batch groups
   - Each batch calls `fetchCategoriesFromAPI(batch, options)`
   - Continues processing even if some batches fail

4. **Result Combination**:
   - Iterates through batch results
   - For fulfilled promises, merges results into combined Map
   - For rejected promises, logs error but continues processing

5. **Logging**:
   - Logs total requested, total fetched, batch count, and any failures

6. **Return**:
   - Returns combined `Map<string, Array<Category>>` with all successful results

**Batch Processing Example**:
```javascript
// 1200 products → 3 batches of 500, 500, 200
// Execute batches 1-5 concurrently, then 6-10, etc.
// If batch 2 fails, batches 1 and 3 still succeed
```

#### Step 4: Extract Categories from Projection

**Method**: `CategoryService.extractCategories(productProjection)` (private)

**Process**:

1. **Validation**:
   - Returns empty array if `productProjection.categories` is missing

2. **Category Extraction**:
   - Filters out null/undefined category references
   - Maps each category reference:
     - If `catRef.obj` exists (expanded), returns expanded category object
     - Otherwise, returns minimal object with `id` and `typeId`

3. **Return**:
   - Returns array of expanded category objects

**Category Structure**:
```javascript
[
  {
    id: "category-123",
    key: "electronics",
    name: { en: "Electronics" },
    custom: {
      fields: {
        connectorStripeTax_TaxCode: "txcd_12345678"
      }
    },
    parent: { obj: { /* parent category */ } }
  },
  // ... more categories
]
```

#### Step 5: Cache Management

**Method**: `CategoryService.getFromCache(productIds, staged, locale)` (private)

**Process**:

1. **Cache Key Generation**:
   - Generates key: `categories_{staged}_{locale}`
   - Example: `categories_current_en` or `categories_staged_default`

2. **Cache Lookup**:
   - Gets cache entry: `this.cache.get(cacheKey)`
   - Returns `null` if cache entry doesn't exist

3. **TTL Validation**:
   - Checks if cache is expired: `Date.now() - cached.timestamp > this.cacheTTL`
   - Deletes expired cache entry and returns `null`

4. **Product Filtering**:
   - Filters cache to only include requested product IDs
   - Creates result Map with matching products

5. **Return**:
   - Returns Map of cached categories (may be partial)
   - Returns `null` if cache expired or empty

**Method**: `CategoryService.saveToCache(categoriesMap, staged, locale)` (private)

**Process**:

1. **Cache Key Generation**:
   - Generates key: `categories_{staged}_{locale}`

2. **Cache Storage**:
   - Stores Map with timestamp:
     ```javascript
     {
       categoriesMap: categoriesMap,
       timestamp: Date.now()
     }
     ```

3. **Logging**:
   - Logs cache save with cache key and product count

**Cache Structure**:
```javascript
cache = Map {
  "categories_current_en" => {
    categoriesMap: Map { "product-1" => [...], "product-2" => [...] },
    timestamp: 1234567890
  }
}
```

## Implementation Details

### Product Projections API

**Endpoint**: `GET /{projectKey}/product-projections`

**Query Parameters**:
- `where`: Filter predicate (e.g., `id in ("id1", "id2")`)
- `staged`: Boolean - Use staged or current version
- `expand`: `['categories[*]']` only (no nested `categories[*].custom` / `categories[*].parent`)
- `limit`: Maximum results (500 for commercetools)
- `locale`: Optional locale string

**Category Expansion**:
- `categories[*]` returns each category reference as a full object (`id`, `key`, `name`, `custom.fields`, `parent` reference). The category's own `custom.fields.connectorStripeTax_TaxCode` is available because category objects include their custom fields by default; parent objects are NOT expanded.

### Batch Processing Strategy

**Batch Size**: 500 products (commercetools API limit)

**Concurrency Limit**: 5 batches concurrently

**Rationale**:
- Prevents overwhelming the API with too many concurrent requests
- Balances throughput with API rate limits
- Allows other operations to proceed while batches execute

**Error Handling**:
- Uses `Promise.allSettled()` instead of `Promise.all()`
- Failed batches don't prevent successful batches from completing
- Logs errors for failed batches but continues processing

### Caching Strategy

**Cache Type**: In-memory Map

**TTL**: 5 minutes (300,000 milliseconds)

**Cache Key Format**: `categories_{staged}_{locale}`

**Cache Structure**:
```javascript
{
  categoriesMap: Map<productId, Array<Category>>,
  timestamp: number
}
```

**Partial Cache Support**:
- If some products are cached and others are not, uses cached data
- Only fetches missing products from API
- Merges cached and fetched results before returning

**Cache Benefits**:
- Reduces API calls for repeated product queries
- Improves performance for carts with common products
- Supports partial cache hits for incremental fetching

### Category Expansion

**Expansion Path**: `categories[*]`

**Expanded Data**:
- Category ID, key, name
- Custom type fields (e.g., tax codes)
- Parent category references (if expanded)

**Why Product Projections**:
- Product Projections API supports category expansion
- More efficient than fetching categories separately
- Returns all necessary data in single query

## Usage Example

### Complete Flow Example

```javascript
// 1. Extract product IDs from cart
const productIds = cart.lineItems.map(item => item.productId);
// ["product-1", "product-2", "product-3"]

// 2. Get categories for products
const categoriesMap = await categoryService.getCategoriesForProducts(
  productIds,
  {
    staged: false,
    locale: cart.locale || 'en',
    useCache: true
  }
);

// 3. Result structure
// Map {
//   "product-1" => [
//     { id: "cat-1", key: "electronics", custom: { fields: {...} } },
//     { id: "cat-2", key: "computers", custom: { fields: {...} } }
//   ],
//   "product-2" => [
//     { id: "cat-3", key: "books", custom: { fields: {...} } }
//   ],
//   "product-3" => []
// }

// 4. Use categories for tax code resolution
for (const lineItem of cart.lineItems) {
  const productCategories = categoriesMap.get(lineItem.productId) || [];
  const taxCode = taxCodeService.getTaxCodeForProduct(lineItem, productCategories);
  // ...
}
```

### Cache Hit Example

```javascript
// First request: Fetches from API
const categories1 = await categoryService.getCategoriesForProducts(
  ["product-1", "product-2"],
  { useCache: true }
);
// Logs: "Categories fetched from API" (requested: 2, fetched: 2)

// Second request (within 5 minutes): Uses cache
const categories2 = await categoryService.getCategoriesForProducts(
  ["product-1", "product-2"],
  { useCache: true }
);
// Logs: "Categories retrieved from cache (full hit)" (productsCount: 2)
// No API call made
```

### Partial Cache Hit Example

```javascript
// First request: Fetches products 1-3
await categoryService.getCategoriesForProducts(
  ["product-1", "product-2", "product-3"],
  { useCache: true }
);

// Second request: Products 1-2 cached, product-4 not cached
const categories = await categoryService.getCategoriesForProducts(
  ["product-1", "product-2", "product-4"],
  { useCache: true }
);
// Logs: "Categories retrieved from cache (partial hit)" (cachedCount: 2, missingCount: 1)
// Only fetches product-4 from API
```

### Batch Processing Example

```javascript
// 1200 products → 3 batches
const productIds = Array.from({ length: 1200 }, (_, i) => `product-${i}`);

const categoriesMap = await categoryService.getCategoriesForProducts(
  productIds,
  { useCache: false }
);
// Logs: "Splitting into batches" (totalProducts: 1200, batchCount: 3, batchSize: 500)
// Executes batches 1-3 concurrently (up to 5 at a time)
// Logs: "All batches processed" (totalRequested: 1200, totalFetched: 1200)
```

## Technical Notes

### Performance Considerations

- **Caching**: 5-minute TTL cache reduces API calls for repeated products
- **Partial Cache**: Uses cached data and only fetches missing products
- **Batch Processing**: Handles large product sets efficiently
- **Concurrent Execution**: Up to 5 batches concurrently for optimal throughput
- **Single API Call**: Uses Product Projections with expansion to get all data in one query
- **Early Returns**: Returns immediately on full cache hit

### Edge Cases Handled

- **Empty Product IDs**: Returns empty Map immediately
- **Null/Undefined IDs**: Filters out invalid IDs before processing
- **Duplicate IDs**: Removes duplicates before API calls
- **Cache Expiration**: Automatically invalidates expired cache entries
- **Partial Cache**: Handles cases where some products are cached and others are not
- **Batch Failures**: Individual batch failures don't prevent successful batches
- **Missing Categories**: Products without categories return empty arrays
- **Unexpanded Categories**: Handles category references that aren't expanded
- **API Errors**: Logs errors and continues processing where possible

### Logging and Debugging

- **Request Logging**: Logs total products, staged flag, locale, and cache setting
- **Cache Operations**: Logs cache hits (full/partial) and misses
- **API Calls**: Logs requested count, fetched count, and failed count
- **Batch Processing**: Logs batch count, batch size, and concurrency limits
- **Error Logging**: Logs batch failures with batch index and error details
- **Performance Metrics**: Logs cache save operations with product counts

### API Integration Details

**Product Projections API Endpoint**:
```
GET /{projectKey}/product-projections
```

**Query Parameters**:
- `where`: `id in ("id1", "id2", ...)`
- `staged`: `true` or `false`
- `expand`: `['categories[*]']`
- `limit`: `500` (maximum)
- `locale`: Optional locale string

**Response Structure**:
```javascript
{
  results: [
    {
      id: "product-id",
      categories: [
        {
          id: "category-id",
          obj: { /* expanded category */ }
        }
      ]
    }
  ]
}
```

**Rate Limits**:
- commercetools API has rate limits
- Concurrent batch execution (max 5) balances throughput with rate limits
- Cache reduces API calls for repeated products

## Configuration Requirements

### Environment Variables

No additional environment variables are required. The service uses commercetools credentials configured in the API client (`createApiRoot()`).

### commercetools Setup

1. **Product Projections API**: Must be enabled in commercetools project
2. **Category Expansion**: Categories must be expandable via `categories[*]`
3. **Custom Types**: Categories should have custom types configured if tax codes are stored in categories

### Cache Configuration

**Cache TTL**: 5 minutes (hardcoded, not configurable)

**Cache Invalidation**:
- Automatic: After 5 minutes TTL
- Manual: Via `categoryService.clearCache()` method

**Cache Scope**: Per service instance (in-memory, not shared across instances)

## Related Documentation

- `process-category-taxcode-selection.md`: Tax code selection that uses retrieved categories
- `process-tax-orchestration.md`: Complete tax calculation flow that uses category service
- commercetools API client: `tax-calculator/src/clients/create.client.js`
- Product Projections API: commercetools documentation

## Summary

The process of category retrieval is a high-performance, cache-optimized system that:

1. **Validates and deduplicates** product IDs before processing
2. **Uses intelligent caching** with 5-minute TTL and partial cache support
3. **Handles large product sets** through batch processing (500 per batch)
4. **Executes batches concurrently** (up to 5 at a time) for optimal throughput
5. **Expands categories** with custom types in a single API call
6. **Merges cached and fetched results** for complete data sets
7. **Handles errors gracefully** with `Promise.allSettled()` for batch resilience
8. **Provides comprehensive logging** for cache operations, API calls, and batch processing

This system ensures efficient, scalable, and maintainable category retrieval for e-commerce platforms. The caching strategy reduces API calls for repeated products, batch processing handles large catalogs efficiently, and partial cache support optimizes incremental fetching. The concurrent batch execution balances throughput with API rate limits, ensuring optimal performance for tax calculations and other category-dependent operations.

