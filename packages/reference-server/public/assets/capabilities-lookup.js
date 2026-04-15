/**
 * Trace console — eligibility filter.
 *
 * Given a (country, currency, captureMode) tuple, return the list of
 * APM catalog entries whose declared capabilities cover it. This is the
 * v2.2 harness answer to the "70 buttons" problem: instead of forcing the
 * viewer to scroll past all 70 APMs, they pick a market and the eligible
 * set derives itself (same pattern as Checkout.com Flow Demo and Adyen
 * Drop-in).
 *
 * Pure function over the catalog — no side effects, no fetch, no DOM.
 */

/**
 * @param {{ country?: string, currency?: string, captureMode?: 'GATEWAY'|'MERCHANT', catalog: Array<any> }} opts
 * @returns {Array<any>} filtered catalog entries
 */
export function getEligibleApms({ country, currency, captureMode, catalog }) {
  return catalog.filter((apm) => {
    if (country && Array.isArray(apm.countries) && apm.countries.length > 0) {
      if (!apm.countries.includes(country)) return false;
    }
    if (currency && Array.isArray(apm.currencies) && apm.currencies.length > 0) {
      if (!apm.currencies.includes(currency)) return false;
    }
    if (captureMode === 'MERCHANT') {
      // Only APMs that actually support merchant-initiated authorize-then-capture
      if (!apm.capabilities?.supportsMerchantInitiated) return false;
      if (!apm.capabilities?.supportsSeparateCapture) return false;
    }
    if (captureMode === 'GATEWAY') {
      if (!apm.capabilities?.supportsGatewayInitiated) return false;
    }
    return true;
  });
}

/**
 * Extract the union of all country codes across the catalog, sorted.
 * Used to populate the country dropdown.
 */
export function uniqueCountries(catalog) {
  const set = new Set();
  for (const apm of catalog) {
    for (const c of apm.countries ?? []) set.add(c);
  }
  return Array.from(set).sort();
}

/**
 * Extract the union of all currency codes across the catalog, sorted.
 */
export function uniqueCurrencies(catalog) {
  const set = new Set();
  for (const apm of catalog) {
    for (const c of apm.currencies ?? []) set.add(c);
  }
  return Array.from(set).sort();
}
