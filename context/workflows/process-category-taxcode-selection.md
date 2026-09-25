# Process Category Tax Code Selection

## Description

The process of tax code selection within product categories is a direct tax code resolution mechanism implemented in the tax-calculator service. This system automatically determines the appropriate Stripe tax code for products by searching through the categories directly assigned to the product, checking each category's custom fields for a configured tax code.

The process is designed to handle e-commerce scenarios where products can belong to multiple categories simultaneously, and tax codes are defined at the category level. The solution uses a "first-found" approach, returning the first tax code encountered in the categories assigned to the product, ensuring efficient and predictable tax code assignment.

**Main Flow**: The system first obtains product category information through the commercetools API using Product Projections with expansion of categories and their custom types. Then, it applies the main strategy (STRATEGY 1) to search for the tax code in category custom fields, checking only the categories directly assigned to the product (no parent hierarchy traversal).

## Problem

E-commerce platforms like commercetools organize products within hierarchical category structures where:
- Products can belong to multiple categories simultaneously
- Categories form tree structures with parent-child relationships
- Tax codes need to be assigned at the appropriate level of the hierarchy
- Direct product-level tax code assignment may not be feasible for all products

The main challenges addressed by this solution include:

1. **Direct Category Tax Code Discovery**: The system searches for tax codes in the categories directly assigned to the product, checking each category's custom fields.

2. **Multiple Category Handling**: Products can be assigned to multiple categories, and the system searches through all assigned categories to find the first available tax code.

3. **Performance Optimization**: The system efficiently searches through categories without excessive API calls or processing time by checking only direct categories.

4. **Fallback Strategy**: When no tax code is found in any assigned category, the system provides clear error reporting for configuration issues.

5. **Category Data Retrieval**: The system efficiently obtains expanded categories with their custom types from commercetools before performing the tax code search.

## Solution Found

The solution implements a direct category search algorithm that:

1. **Retrieves categories from commercetools API**: Uses Product Projections API to obtain expanded categories with their custom types
2. **Searches through all product categories**: Iterates through each category directly assigned to a product
3. **Checks category custom fields**: Examines each category's custom fields for stored tax codes
4. **Returns first match**: Uses a first-found approach, returning the first tax code encountered in the assigned categories
5. **Error handling**: Throws clear error when no tax code is found in any assigned category

### Key Features

- **Category Retrieval from API**: Integration with commercetools Product Projections API to obtain expanded categories with custom types
- **Direct Category Search**: Checks only categories directly assigned to the product (no parent hierarchy traversal)
- **First-Found Logic**: Returns the first tax code found in the category order (first-found approach)
- **Category Custom Field Integration**: Direct integration with commercetools category custom type fields
- **Category Caching**: In-memory cache system to optimize multiple category queries
- **Comprehensive Logging**: Detailed audit trail for tax code decisions and source tracking

## Solution Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│              Tax Orchestrator Service                            │
│         orchestrateTaxCalculation(cart)                          │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: Get Categories from commercetools API                  │
│  categoryService.getCategoriesForProducts(productIds)            │
│                                                                   │
│  - Extract product IDs from cart line items                      │
│  - Query Product Projections API                                │
│  - Expand: categories[*], categories[*].custom,                 │
│    categories[*].parent, categories[*].parent.custom            │
│  - Cache results (5 min TTL)                                    │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│              Returns: categoriesMap                              │
│    Map<productId, Array<expandedCategories>>                     │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│         For each line item in cart:                              │
│  taxCodeService.getTaxCodeForProduct(                            │
│    lineItem,                                                     │
│    categoriesMap.get(lineItem.productId)                        │
│  )                                                               │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│         STRATEGY 1: Check Category Custom Type                  │
│    getCustomTypeCategoryTaxCode(categories)                      │
└───────────────────────┬─────────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
        │  For each category in         │
        │  categories array             │
        │  (directly assigned)          │
        │                               │
        ▼                               ▼
┌───────────────────────┐   ┌───────────────────────┐
│  Category 1           │   │  Category 2           │
│  (if multiple)        │   │  (if multiple)        │
└───────────┬───────────┘   └───────────┬───────────┘
            │                           │
            ▼                           ▼
    ┌───────────────────────────────────────┐
    │ Check category custom field            │
    │ category.custom.fields                 │
    │ [TAX_CODE_CUSTOM_TYPE_NAME]            │
    └───────────────┬───────────────────────┘
                    │
            ┌───────┴────────┐
            │                │
            │ Found?         │ Not Found
            │ Yes → RETURN   │ Continue to next
            │                │ category
            │                │
            ▼                ▼
    ┌───────────────┐  ┌───────────────┐
    │ Return first  │  │ Check next    │
    │ tax code found│  │ category      │
    └───────────────┘  └───────────────┘
```

## Step-by-Step Solution Description

### Overview Flow

1. **Category Retrieval**: The Tax Orchestrator Service extracts product IDs from the cart and calls `categoryService.getCategoriesForProducts()` to obtain expanded categories from commercetools API
2. **Entry Point**: For each line item in the cart, `getTaxCodeForProduct(cartLineItem, productCategories)` is called with the obtained categories
3. **Primary Search**: `getCustomTypeCategoryTaxCode()` is invoked to search through categories directly assigned to the product (STRATEGY 1)
4. **Category Iteration**: For each category assigned to the product, checks the category's custom fields for a tax code
5. **Direct Check**: Checks each category's `custom.fields.connectorStripeTax_TaxCode` field directly (no parent traversal)
6. **Result**: Returns the first tax code found in any assigned category, or throws error if none is found

### Detailed Steps

#### Step 1: Category Retrieval from commercetools API

**Service**: `CategoryService.getCategoriesForProducts(productIds, options)`

**Process**:

1. **Input Validation**:
   - Filters duplicate and null IDs
   - Returns empty Map if there are no product IDs

2. **Cache Verification**:
   - If `useCache = true` (default), checks in-memory cache
   - Cache has TTL of 5 minutes
   - If all products are in cache and not expired, returns from cache

3. **commercetools API Query**:
   - Uses `Product Projections API` with the following parameters:
     - `where`: Filter by product IDs (`id in ("id1", "id2", ...)`)
     - `staged`: Staged or current version (default: false = current)
     - `locale`: Locale for projections (only included when provided)
     - `expand`: Category expansion — `['categories[*]']` only. Parent and nested `custom` paths are NOT expanded; the active flow does not require them because `getCustomTypeCategoryTaxCode` only inspects each direct category's `custom.fields`.
     - `limit`: Maximum 500 products per query

4. **Batch Handling**:
   - If there are more than 500 products, divides into batches of 500
   - Executes batches in parallel using `Promise.allSettled()`
   - Combines results from all batches

5. **Category Extraction**:
   - For each Product Projection, extracts expanded categories
   - Creates a Map where `key = productId`, `value = Array<Category>`
   - Each category includes: `id`, `key`, `name`, `custom.fields`, `parent` (expanded)

6. **Cache Storage**:
   - Saves the complete Map to cache with timestamp
   - Cache key: `categories_{staged}_{locale}`

7. **Return**:
   - Returns `Map<string, Array<Category>>` with all expanded categories

**Code Example**:
```javascript
const categoriesMap = await categoryService.getCategoriesForProducts(
  productIds,
  {
    staged: false,
    locale: cart.locale || undefined,
    useCache: true
  }
);
```

#### Step 2: Entry Point - Get Tax Code for Product

**Method**: `TaxCodeService.getTaxCodeForProduct(cartLineItem, productCategories)`

**Parameters**:
- `cartLineItem`: commercetools cart line item object
- `productCategories`: Array of expanded categories obtained from the categories Map

**Process**:

1. **Validation**:
   - Verifies that `cartLineItem` exists, throws error if null/undefined

2. **STRATEGY 1: Check Category Custom Type** (Main Flow):
   - Calls `getCustomTypeCategoryTaxCode(productCategories)`
   - If tax code is found:
     - Logs the decision with `logTaxCodeDecision()`
     - Returns the found tax code

3. **Additional Strategies** (Commented, available for future use):
   - **STRATEGY 2**: Check product custom field
   - **STRATEGY 3**: Look up category in customer's mapping
   - **STRATEGY 4**: Traverse parent categories using mapping

4. **Error Handling**:
   - If no tax code is found, throws `TaxCodeNotFoundError` with:
     - Product ID and name
     - All categories assigned to the product
     - Actionable error messages for configuration

#### Step 3: STRATEGY 1 - Check Category Custom Type (Main Flow)

**Method**: `TaxCodeService.getCustomTypeCategoryTaxCode(categories)`

**Process**:

1. **Initial Validation**:
   - If `categories.length === 0`, returns `null`

2. **Category Iteration**:
   - For each category in the `categories` array (categories directly assigned to the product):
     - Checks `category.custom?.fields?.[TAX_CODE_CUSTOM_TYPE_NAME]`
     - If a tax code is found, **returns immediately** (first-found approach)
     - If not found, continues with the next category

3. **Return**:
   - If no category has a tax code, returns `null`

**Key Features**:
- **First-Found Approach**: Returns the first tax code found in the category order
- **Multiple Categories**: If a product has multiple categories, searches all until finding the first one with a tax code
- **Direct Search Only**: Only checks categories directly assigned to the product, does not traverse parent categories

**Code Implementation**:
```javascript
getCustomTypeCategoryTaxCode(categories) {
  if (categories.length === 0) {
    return null;
  }
  
  // For each category assigned to the product
  for (const category of categories) {
    const taxCode = category?.custom?.fields?.[TAX_CODE_CUSTOM_TYPE_NAME];
    if (taxCode) {
      return taxCode; // First-found: returns immediately
    }
  }
  
  return null;
}
```

**Search Example**:
```
Product assigned to:
  - Category A (no tax code) → Continue
  - Category B (tax code: "txcd_12345678") ✓ → RETURN immediately
  - Category C (tax code: "txcd_87654321") → Not checked (already found)

Result: "txcd_12345678" (returned from Category B)
```

**Note**: The method `findFirstTaxCodeInHierarchy()` exists in the codebase but is not currently used in the main flow. The current implementation only checks categories directly assigned to the product.

#### Step 5: Error Handling

**Class**: `TaxCodeNotFoundError`

**When Thrown**:
- When no tax code is found through any strategy
- When the product has no categories assigned
- When no category in the hierarchy has a tax code configured

**Error Information**:
- Product ID and product name
- All categories assigned to the product (IDs, keys, names)
- Actionable error messages for configuration
- Format compatible with commercetools API for error responses

**Error Example**:
```javascript
throw new TaxCodeNotFoundError(
  cartLineItem.productId,
  cartLineItem.name || 'Unknown Product',
  cartLineItem.categories || []
);
```

## Other Strategies (Brief Description)

Although currently only STRATEGY 1 is active, the code includes other commented strategies that can be activated in the future:

### STRATEGY 2: Check Product Custom Field
**Description**: Searches for the tax code directly in product or variant custom fields. Checks `lineItem.custom.fields` and `lineItem.variant.custom.fields` for the `connectorStripeTax_TaxCode` field.

**Use**: Useful when specific tax codes need to be assigned to individual products without depending on categories.

### STRATEGY 3: Look Up Category in Customer's Mapping
**Description**: Searches for the tax code in a customer configuration mapping. Uses `taxCodeMappingConfig.getTaxCodeForCategory()` to look up predefined tax codes by category ID or key.

**Use**: Allows configuring tax codes through configuration files without modifying categories in commercetools.

### STRATEGY 4: Traverse Parent Categories Using Mapping
**Description**: Similar to STRATEGY 1, but uses configuration mapping instead of custom fields. Traverses the parent hierarchy searching for tax codes in the configuration mapping.

**Use**: Alternative to STRATEGY 1 when preferring external configuration over custom fields.

## Implementation Details

### Custom Type Configuration

**Custom Field Name**: `connectorStripeTax_TaxCode`

**Structure in commercetools**:
```javascript
// Custom type definition
{
  key: 'connector-stripe-tax-category',
  name: {
    en: 'Stripe Tax Category Configuration',
  },
  resourceTypeIds: ['category'],
  fieldDefinitions: [
    {
      name: 'connectorStripeTax_TaxCode',
      label: {
        en: 'Stripe Tax Code',
      },
      required: false,
      type: {
        name: 'String',
      },
      inputHint: 'SingleLine',
    },
  ],
}
```

**Code Access**:
```javascript
const taxCode = category.custom?.fields?.connectorStripeTax_TaxCode;
```

**Tax Code Format**: String in Stripe format (e.g., `"txcd_99999999"`)

### First-Found Approach

The system implements a "first-found" strategy which means:
- For products with multiple categories, the first category that yields a tax code is used
- Only categories directly assigned to the product are checked (no parent hierarchy traversal)
- This provides predictable and deterministic behavior while being efficient
- The search stops as soon as a tax code is found in any assigned category

### Category Expansion in API

The system uses minimal category expansion in the Product Projections query:

```javascript
expand: [
  'categories[*]'   // Expands category references; custom.fields is included by default on each category
]
```

Only `categories[*]` is requested. Nested expansions (`categories[*].custom`, `categories[*].parent`, `categories[*].parent.custom`) are NOT used because `tax-code.service.js → getCustomTypeCategoryTaxCode` only reads `category.custom.fields.connectorStripeTax_TaxCode` on each directly assigned category — no parent traversal happens in the active flow.

### Caching Strategy

**In-Memory Cache**:
- TTL: 5 minutes
- Key: `categories_{staged}_{locale}`
- Stores: `Map<productId, Array<Category>>`
- Benefit: Reduces API calls for multiple products in the same cart

**Invalidation**:
- Automatic after 5 minutes
- Manual via `categoryService.clearCache()`

## Usage Example

### Complete Flow Example

```javascript
// 1. Tax Orchestrator retrieves categories
const productIds = cart.lineItems.map(item => item.productId);
const categoriesMap = await categoryService.getCategoriesForProducts(
  productIds,
  {
    staged: false,
    locale: cart.locale,
    useCache: true
  }
);

// 2. For each line item, get tax code
for (const lineItem of cart.lineItems) {
  const productCategories = categoriesMap.get(lineItem.productId) || [];
  
  // 3. Get tax code using STRATEGY 1
  const taxCode = taxCodeService.getTaxCodeForProduct(
    lineItem,
    productCategories
  );
  
  // 4. Use tax code in Stripe request
  lineItemData.tax_code = taxCode;
  taxRequest.line_items.push(lineItemData);
}
```

### Category Structure Example

```javascript
// Example of expanded category from commercetools
{
  id: "category-123",
  key: "electronics",
  name: {
    en: "Electronics"
  },
  custom: {
    fields: {
      connectorStripeTax_TaxCode: "txcd_12345678"
    }
  },
  parent: {
    obj: {
      id: "category-456",
      key: "products",
      name: {
        en: "Products"
      },
      custom: {
        fields: {
          connectorStripeTax_TaxCode: null // No tiene tax code
        }
      },
      parent: null // Categoría raíz
    }
  }
}
```

## Technical Notes

### Performance Considerations

- **First Match**: The algorithm stops at the first match, minimizing traversal depth
- **Processed Categories Set**: Prevents redundant processing
- **Depth Limit**: Ensures predictable execution time
- **No Additional API Calls**: Uses pre-loaded data during traversal
- **Category Caching**: Reduces API calls for repeated products
- **Batch Processing**: Efficiently handles more than 500 products by dividing into batches

### Edge Cases Handled

- **Products without assigned categories**: Returns clear error indicating no categories
- **Categories without parent references**: Correctly handles root categories
- **Circular references in hierarchies**: Prevents infinite loops with processed Set
- **Deep category trees**: Truncates after 10 levels
- **Missing or malformed custom field data**: Safely handles null/undefined
- **Products not found in API**: Returns empty Map for those products
- **API batch failures**: Uses `Promise.allSettled()` to continue with successful batches

### Logging and Debugging

- **Comprehensive Logging**: Detailed logging at each decision point
- **Tax Code Source Tracking**: Identifies which category provided the tax code
- **Detailed Error Messages**: Include complete category information for troubleshooting
- **Audit Trail**: Maintains timestamp and category details for each tax code assignment
- **Cache Logging**: Records cache hits and misses for performance analysis

### API Integration Details

**Product Projections API Endpoint**:
```
GET /{projectKey}/product-projections
```

**Query Parameters**:
- `where`: Filter by product IDs
- `staged`: Staged or current version
- `locale`: Locale for projections
- `expand`: Expansion of categories and parents
- `limit`: Maximum 500 results per query

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

## Configuration Requirements

### commercetools Setup

1. **Custom Type for Categories**:
   - Create custom type with key: `connector-stripe-tax-category`
   - Add field: `connectorStripeTax_TaxCode` (String, optional)
   - Assign to resource type: `category`

2. **Tax Code Assignment**:
   - For each category that needs a tax code, assign the value in the custom field
   - Format: `txcd_XXXXXXXX` (Stripe tax code format)

3. **Category Structure**:
   - Ensure parent-child relationships are correctly configured
   - Categories must have `parent` reference when applicable

### Environment Variables

No additional environment variables are required for this functionality. It uses the commercetools credentials configured in the API client.

## Related Documentation

- `process-category-selection.md`: Detailed documentation of the category selection algorithm
- `ship-from-tax-calculation-flow.md`: Complete tax calculation flow
- `proportional-shipping-calculation.md`: Proportional shipping calculation

## Summary

The process of tax code selection within product categories is a robust system that:

1. **Retrieves categories** from commercetools API using Product Projections with category expansion
2. **Applies STRATEGY 1** as the main flow, searching for tax codes in category custom fields
3. **Checks direct categories** only - searches through categories directly assigned to the product (no parent hierarchy traversal)
4. **Returns the first tax code found** using a first-found approach
5. **Optimizes performance** with caching and batch processing
6. **Provides clear errors** when no tax code is found in any assigned category

This system ensures efficient, predictable, and maintainable tax code assignment for products in e-commerce platforms. The direct category search approach provides simplicity and performance while requiring tax codes to be configured at the category level where products are directly assigned.

