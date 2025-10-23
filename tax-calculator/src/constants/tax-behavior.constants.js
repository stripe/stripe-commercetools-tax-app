/**
 * Tax behavior constants for Stripe Tax API
 * These are the only valid values accepted by Stripe's tax_behavior parameter
 */

export const TAX_BEHAVIOR_INCLUSIVE = 'inclusive';
export const TAX_BEHAVIOR_EXCLUSIVE = 'exclusive';

/**
 * Array of all valid tax behavior values
 */
export const VALID_TAX_BEHAVIORS = [TAX_BEHAVIOR_INCLUSIVE, TAX_BEHAVIOR_EXCLUSIVE];
