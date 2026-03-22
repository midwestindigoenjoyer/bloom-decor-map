/**
 * Geocoding routes
 *
 * Wraps Nominatim (OpenStreetMap's geocoding service) to convert addresses
 * to coordinates and provide autocomplete suggestions.
 */

const express = require('express');
const router = express.Router();
const { geocode, autocomplete } = require('../utils/nominatim');

/**
 * GET /api/geocode?address=...
 *
 * Convert a human-readable address to lat/lon coordinates.
 * Used when the user submits a full address search.
 *
 * Query params:
 *   address (required) - The address or place name to look up
 *
 * Returns: { lat, lon, display_name }
 */
router.get('/geocode', async (req, res) => {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({ error: 'address is required' });
  }

  try {
    const result = await geocode(address);

    if (!result) {
      return res.status(404).json({ error: 'Address not found' });
    }

    res.json(result);
  } catch (error) {
    console.error('Geocoding error:', error.message);
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'Geocoding timed out. Please try again.' });
    }
    res.status(500).json({ error: 'Geocoding failed: ' + error.message });
  }
});

/**
 * GET /api/autocomplete?q=...
 *
 * Return up to 5 address suggestions for a partial query.
 * Requires at least 3 characters; returns [] otherwise.
 *
 * Query params:
 *   q (required) - Partial address string (min 3 chars)
 *
 * Returns: Array of { display_name, lat, lon }
 */
router.get('/autocomplete', async (req, res) => {
  const { q } = req.query;

  try {
    const suggestions = await autocomplete(q);
    res.json(suggestions);
  } catch (error) {
    // Silently return empty list on error — autocomplete is best-effort
    res.json([]);
  }
});

module.exports = router;
