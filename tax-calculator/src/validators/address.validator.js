import validator from 'validator';
import { getValidateMessages } from './helpers.validators.js';

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

export const validateAddress = (address) => {
    const errors = [];

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

    // Check required fields
    for (const field of requirements.required || []) {
        if (!address[field] || validator.isEmpty(address[field].toString().trim())) {
            errors.push({
                code: `MISSING_${field.toUpperCase()}`,
                message: `${field} is required for ${country} tax calculation`
            });
        }
    }

    // Check either/or required fields (for countries like India)
    if (requirements.either_required) {
        const hasAny = requirements.either_required.some(field =>
            address[field] && !validator.isEmpty(address[field].toString().trim())
        );
        if (!hasAny) {
            errors.push({
                code: 'MISSING_REQUIRED_FIELD',
                message: `One of the following is required for ${country}: ${requirements.either_required.join(', ')}`
            });
        }
    }

    // Validate postal code format if present
    if (address.postal_code && requirements.postal_code_regex) {
        if (!requirements.postal_code_regex.test(address.postal_code)) {
            errors.push({
                code: 'INVALID_POSTAL_CODE',
                message: `Invalid postal code format for ${country}`
            });
        }
    }

    // Validate state codes if present and required
    if (address.state && requirements.state_codes) {
        if (!requirements.state_codes.includes(address.state)) {
            errors.push({
                code: 'INVALID_STATE',
                message: `Invalid state code for ${country}. Must be one of: ${requirements.state_codes.join(', ')}`
            });
        }
    }

    // Validate line1 length if present
    if (address.line1) {
        if (!validator.isLength(address.line1, { min: 1, max: 200 })) {
            errors.push({
                code: 'INVALID_LINE1',
                message: 'Address line1 must be between 1 and 200 characters'
            });
        }
    }

    // Validate city length if present
    if (address.city) {
        if (!validator.isLength(address.city, { min: 1, max: 100 })) {
            errors.push({
                code: 'INVALID_CITY',
                message: 'City must be between 1 and 100 characters'
            });
        }
    }

    return errors;
};

export const validateCartAddress = (cartRequest) => {
    const errors = [];

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

    // Create address object for validation
    const addressToValidate = {
        country: cartRequest.country,
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