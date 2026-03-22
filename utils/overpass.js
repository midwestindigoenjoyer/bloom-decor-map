/**
 * Overpass API client
 *
 * Overpass is a read-only OSM API for querying geographic data.
 * We use two public servers and fall back to the second if the first fails.
 *
 * Docs: https://overpass-api.de/api/interpreter
 */

const axios = require('axios');

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

/**
 * Send an Overpass QL query, trying each server in order until one succeeds.
 *
 * @param {string} query - Overpass QL query string
 * @param {number} [timeoutMs=45000] - Request timeout in milliseconds
 * @returns {Promise<object[]>} Array of OSM elements from the response
 * @throws If all servers fail or the request times out
 */
async function queryOverpass(query, timeoutMs = 45000) {
  let lastError;

  for (const server of OVERPASS_SERVERS) {
    try {
      const response = await axios.post(server, query, {
        headers: { 'Content-Type': 'text/plain' },
        timeout: timeoutMs
      });
      return response.data.elements || [];
    } catch (err) {
      console.error(`Overpass server ${server} failed:`, err.message);
      lastError = err;
      // Try the next server
    }
  }

  throw lastError;
}

module.exports = { queryOverpass };
