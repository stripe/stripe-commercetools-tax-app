import validator from 'validator';

const COUNTRY_ADDRESS_REQUIREMENTS = {
    US: {
        required: ['line1', 'city', 'state', 'postal_code', 'country'],
        postal_code_regex: /^\d{5}(-\d{4})?$/,
        state_codes: ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']
    },
    CA: {
        required: ['country'],
        optional: ['postal_code', 'state'],
        postal_code_regex: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/,
        state_codes: ['AB', 'BC', 'MB', 'NB', 'NL', 'NT', 'NS', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']
    },
    IN: {
        required: ['country'],
        either_required: ['postal_code', 'state'],
        postal_code_regex: /^\d{6}$/
    },
    DEFAULT: {
        required: ['country'],
        optional: ['state', 'postal_code']
    }
};

/**
 * Validates required fields for an address
 * @param {Object} address - The address object to validate
 * @param {Object} requirements - The country-specific requirements
 * @param {string} country - The country code
 * @returns {Array} Array of validation errors
 */
const validateRequiredFields = (address, requirements, country) => {
    const errors = [];
    const requiredFields = requirements.required || [];

    for (const field of requiredFields) {
        const fieldValue = address[field];
        if (!fieldValue || validator.isEmpty(fieldValue.toString().trim())) {
            errors.push({
                code: `MISSING_${field.toUpperCase()}`,
                message: `${field} is required for ${country} tax calculation`
            });
        }
    }

    return errors;
};

/**
 * Validates either/or required fields (e.g., postal_code OR state for India)
 * @param {Object} address - The address object to validate
 * @param {Object} requirements - The country-specific requirements
 * @param {string} country - The country code
 * @returns {Array} Array of validation errors
 */
const validateEitherRequiredFields = (address, requirements, country) => {
    const errors = [];
    
    if (!requirements.either_required) {
        return errors;
    }

    const hasAny = requirements.either_required.some(field => {
        const fieldValue = address[field];
        return fieldValue && !validator.isEmpty(fieldValue.toString().trim());
    });

    if (!hasAny) {
        errors.push({
            code: 'MISSING_REQUIRED_FIELD',
            message: `One of the following is required for ${country}: ${requirements.either_required.join(', ')}`
        });
    }

    return errors;
};

/**
 * Validates postal code format if present
 * @param {Object} address - The address object to validate
 * @param {Object} requirements - The country-specific requirements
 * @param {string} country - The country code
 * @returns {Array} Array of validation errors
 */
const validatePostalCode = (address, requirements, country) => {
    const errors = [];

    if (!address.postal_code || !requirements.postal_code_regex) {
        return errors;
    }

    if (!requirements.postal_code_regex.test(address.postal_code)) {
        errors.push({
            code: 'INVALID_POSTAL_CODE',
            message: `Invalid postal code format for ${country}`
        });
    }

    return errors;
};

/**
 * Validates state code if present
 * @param {Object} address - The address object to validate
 * @param {Object} requirements - The country-specific requirements
 * @param {string} country - The country code
 * @returns {Array} Array of validation errors
 */
const validateStateCode = (address, requirements, country) => {
    const errors = [];

    if (!address.state || !requirements.state_codes) {
        return errors;
    }

    if (!requirements.state_codes.includes(address.state)) {
        errors.push({
            code: 'INVALID_STATE',
            message: `Invalid state code for ${country}. Must be one of: ${requirements.state_codes.join(', ')}`
        });
    }

    return errors;
};

/**
 * Validates field length
 * @param {string} fieldValue - The field value to validate
 * @param {number} min - Minimum length
 * @param {number} max - Maximum length
 * @param {string} errorCode - Error code to use
 * @param {string} errorMessage - Error message to use
 * @returns {Object|null} Validation error object or null
 */
const validateFieldLength = (fieldValue, min, max, errorCode, errorMessage) => {
    if (!fieldValue) {
        return null;
    }

    if (!validator.isLength(fieldValue, { min, max })) {
        return {
            code: errorCode,
            message: errorMessage
        };
    }

    return null;
};

export const validateAddress = (address) => {
    if (!address || typeof address !== 'object') {
        return [{ code: 'INVALID_ADDRESS', message: 'Address must be a valid object' }];
    }

    const country = address.country;
    if (!country) {
        return [{ code: 'MISSING_COUNTRY', message: 'Country is required for tax calculation' }];
    }

    if (!validator.isISO31661Alpha2(country)) {
        return [{ code: 'INVALID_COUNTRY', message: 'Country must be a valid ISO 3166-1 alpha-2 code' }];
    }

    const requirements = COUNTRY_ADDRESS_REQUIREMENTS[country] || COUNTRY_ADDRESS_REQUIREMENTS.DEFAULT;
    const errors = [];

    // Validate required fields
    errors.push(...validateRequiredFields(address, requirements, country));

    // Validate either/or required fields
    errors.push(...validateEitherRequiredFields(address, requirements, country));

    // Validate postal code format
    errors.push(...validatePostalCode(address, requirements, country));

    // Validate state code
    errors.push(...validateStateCode(address, requirements, country));

    // Validate line1 length
    const line1Error = validateFieldLength(
        address.line1,
        1,
        200,
        'INVALID_LINE1',
        'Address line1 must be between 1 and 200 characters'
    );
    if (line1Error) {
        errors.push(line1Error);
    }

    // Validate city length
    const cityError = validateFieldLength(
        address.city,
        1,
        100,
        'INVALID_CITY',
        'City must be between 1 and 100 characters'
    );
    if (cityError) {
        errors.push(cityError);
    }

    return errors;
};

export const validateCartAddress = (cartRequest) => {
    if (!cartRequest) {
        return [{ code: 'MISSING_CART', message: 'Cart request is required' }];
    }

    // Extract shipping address based on shipping mode
    let shippingAddress = {};
    if (cartRequest.shippingMode === 'Single') {
        shippingAddress = cartRequest.shippingAddress || {};
    } else if (cartRequest.shipping && cartRequest.shipping[0]) {
        shippingAddress = cartRequest.shipping[0].shippingAddress || {};
    }

    // Validate the delivery address as a whole, country included. Taking the country from
    // cartRequest.country would validate an address that is part delivery destination and part
    // price-selection country — the hybrid behind SB3-218 — and report it as valid.
    const addressToValidate = {
        country: shippingAddress.country,
        postal_code: shippingAddress.postalCode,
        line1: shippingAddress.streetName,
        city: shippingAddress.city,
        state: shippingAddress.state
    };

    return validateAddress(addressToValidate);
};

export const isValidForTaxCalculation = (address) => {
    const errors = validateAddress(address);
    return errors.length === 0;
};