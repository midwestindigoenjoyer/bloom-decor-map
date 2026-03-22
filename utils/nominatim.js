/**
 * Nominatim geocoding client
 *
 * Nominatim is OpenStreetMap's geocoding service. It converts addresses into
 * coordinates (geocoding) and provides address autocomplete suggestions.
 *
 * Usage policy requires a User-Agent header and a maximum of 1 request/second.
 * Docs: https://nominatim.org/release-docs/latest/api/Overview/
 */

const axios = require('axios');

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'PikminDecorMap/1.0';

// Track when we last made a request so we can enforce the 1 req/sec rate limit
let lastRequestTime = 0;

/**
 * Enforce Nominatim's 1 request/second rate limit by sleeping if needed.
 */
async function waitForRateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1000) {
    await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * Geocode an address string to lat/lon coordinates.
 *
 * @param {string} address - Human-readable address or place name
 * @returns {Promise<{ lat: number, lon: number, display_name: string } | null>}
 *   The first matching result, or null if not found
 */
async function geocode(address) {
  await waitForRateLimit();

  const response = await axios.get(`${NOMINATIM_BASE}/search`, {
    params: { q: address, format: 'json', limit: 1 },
    headers: { 'User-Agent': USER_AGENT },
    timeout: 10000
  });

  if (response.data.length === 0) return null;

  const result = response.data[0];
  return {
    lat: parseFloat(result.lat),
    lon: parseFloat(result.lon),
    display_name: result.display_name
  };
}

/**
 * Get up to 5 address autocomplete suggestions for a partial query.
 * Returns an empty array if the query is too short (< 3 chars) or on error.
 *
 * @param {string} q - Partial address query (minimum 3 characters)
 * @returns {Promise<Array<{ display_name: string, lat: number, lon: number }>>}
 */
async function autocomplete(q) {
  if (!q || q.length < 3) return [];

  await waitForRateLimit();

  const response = await axios.get(`${NOMINATIM_BASE}/search`, {
    params: { q, format: 'json', limit: 5, addressdetails: 1 },
    headers: { 'User-Agent': USER_AGENT },
    timeout: 5000
  });

  return response.data.map(r => ({
    display_name: r.display_name,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon)
  }));
}

module.exports = { geocode, autocomplete };
