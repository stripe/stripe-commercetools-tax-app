export function loadConfig() {
  if (process.env.STRIPE_API_TOKEN) {
    return {
      taxProviderApiToken: process.env.STRIPE_API_TOKEN,
    };
  } else {
    throw new Error('Tax provider API token is not provided.');
  }
}
