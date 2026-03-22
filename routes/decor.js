/**
 * Decor routes
 *
 * The core feature routes: look up what Pikmin Bloom decor types exist near
 * a point, browse all decor of one type in a map viewport, and get the full
 * list of known categories.
 *
 * All map data comes from the Overpass API (OpenStreetMap).
 */

const express = require('express');
const router = express.Router();
const { buildOverpassQuery, buildOverpassBboxQuery, buildOverpassBboxQueryMulti, matchDecorCategories, DECOR_MAPPINGS } = require('../decor-mappings');
const { queryOverpass } = require('../utils/overpass');
const { calculateDistance } = require('../utils/haversine');
const { logOverpassMetric } = require('../utils/metrics');

const DEBUG = process.env.DEBUG === 'true';

function debug(...args) {
  if (DEBUG) console.log('[DEBUG]', new Date().toISOString(), ...args);
}

/**
 * GET /api/decor?lat=...&lon=...&radius=200
 *
 * Find all Pikmin Bloom decor types within `radius` meters of a location.
 * Each returned result includes the OSM element's name, category, icon, color,
 * and distance from the searched point. Results are sorted by distance.
 *
 * Query params:
 *   lat    (required) - Latitude of search center
 *   lon    (required) - Longitude of search center
 *   radius (optional) - Search radius in meters (default: 200)
 *
 * Returns: { results: DecorResult[], summary: CategorySummary[], total: number, queryTimeMs: number }
 */
router.get('/decor', async (req, res) => {
  const { lat, lon, radius = 200 } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  const startTime = Date.now();
  debug('Decor lookup at:', lat, lon, 'radius:', radius);

  try {
    const query = buildOverpassQuery(parseFloat(lat), parseFloat(lon), parseInt(radius));
    const elements = await queryOverpass(query, 45000);

    debug('Raw elements from Overpass:', elements.length);

    const decorResults = [];
    const seen = new Set(); // Deduplicate element+category pairs
    const searchLat = parseFloat(lat);
    const searchLon = parseFloat(lon);
    const searchRadius = parseInt(radius);

    elements.forEach(element => {
      if (!element.tags) return;

      const decors = matchDecorCategories(element.tags);
      if (decors.length === 0) return;

      // Nodes have lat/lon directly; ways/relations return a center point.
      const elLat = element.lat ?? element.center?.lat;
      const elLon = element.lon ?? element.center?.lon;
      if (!elLat || !elLon) return;

      // For large-area relations the bounding-box centroid can be miles from
      // the search point even though the feature's boundary touches the circle.
      // Snap the display pin to the search coordinates in that case so the
      // marker appears where the user actually is, not at the feature's center.
      const centerDist = calculateDistance(searchLat, searchLon, elLat, elLon);
      const displayLat = (element.type === 'relation' && centerDist > searchRadius) ? searchLat : elLat;
      const displayLon = (element.type === 'relation' && centerDist > searchRadius) ? searchLon : elLon;

      const name = element.tags.name || decors[0].name;

      // One element can match multiple decor categories (double-decor).
      // Deduplicate by element ID + category name to avoid duplicates from
      // multi-value OSM tags (e.g. cuisine=pizza;burger).
      decors.forEach(decor => {
        const key = `${decor.name}-${element.id}`;
        if (seen.has(key)) return;
        seen.add(key);

        decorResults.push({
          id: element.id,
          category: decor.name,
          icon: decor.icon,
          image: decor.image,
          mapIcon: decor.mapIcon,
          color: decor.color,
          name,
          lat: displayLat,
          lon: displayLon,
          distance: calculateDistance(searchLat, searchLon, displayLat, displayLon)
        });
      });
    });

    // Sort closest-first
    decorResults.sort((a, b) => a.distance - b.distance);

    // Build a per-category count summary for the UI's category breakdown tooltip
    const summaryMap = {};
    decorResults.forEach(result => {
      if (!summaryMap[result.category]) {
        summaryMap[result.category] = { name: result.category, icon: result.icon, color: result.color, count: 0 };
      }
      summaryMap[result.category].count++;
    });

    const elapsed = Date.now() - startTime;
    debug('Decor lookup completed in', elapsed, 'ms, found', decorResults.length, 'results');

    logOverpassMetric({ type: 'search', durationMs: elapsed, success: true, elements: decorResults.length, radius: parseInt(radius) });

    res.json({
      results: decorResults,
      summary: Object.values(summaryMap),
      total: decorResults.length,
      queryTimeMs: elapsed
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('Decor lookup error after', elapsed, 'ms:', error.message);

    logOverpassMetric({ type: 'search', durationMs: elapsed, success: false, error: error.message, radius: parseInt(radius) });

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return res.status(504).json({
        error: 'Overpass API timed out. Try a smaller radius or different location.',
        queryTimeMs: elapsed
      });
    }
    if (error.response?.status === 429) {
      return res.status(429).json({
        error: 'Rate limited by Overpass API. Please wait a moment and try again.',
        queryTimeMs: elapsed
      });
    }
    res.status(500).json({ error: 'Decor lookup failed: ' + error.message });
  }
});

/**
 * GET /api/decor-browse?south=...&west=...&north=...&east=...&category=...
 *
 * Find all locations of a specific decor type within a map bounding box.
 * Used by the "Browse by Decor Type" tab to show all instances in the
 * current viewport.
 *
 * Query params:
 *   south, west, north, east (required) - Bounding box coordinates
 *   category (required) - Decor category name (must match exactly)
 *
 * Returns: { results: DecorResult[], total: number, queryTimeMs: number }
 */
router.get('/decor-browse', async (req, res) => {
  const { south, west, north, east, category } = req.query;

  if (!south || !west || !north || !east || !category) {
    return res.status(400).json({ error: 'south, west, north, east, and category are required' });
  }

  const startTime = Date.now();
  debug('Decor browse for:', category, 'in bbox:', south, west, north, east);

  try {
    const query = buildOverpassBboxQuery(
      parseFloat(south), parseFloat(west),
      parseFloat(north), parseFloat(east),
      category
    );

    if (!query) {
      return res.status(400).json({ error: 'Unknown decor category: ' + category });
    }

    const elements = await queryOverpass(query, 30000);
    const decor = DECOR_MAPPINGS.find(d => d.name === category);

    const bboxCenterLat = (parseFloat(south) + parseFloat(north)) / 2;
    const bboxCenterLon = (parseFloat(west) + parseFloat(east)) / 2;

    const results = elements
      .filter(el => el.tags)
      .map(el => {
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        if (!elLat || !elLon) return null;

        // Snap large-area relations whose centroid falls outside the bbox
        // to the bbox center so their pins remain visible on the map.
        const inBbox = elLat >= parseFloat(south) && elLat <= parseFloat(north) &&
                       elLon >= parseFloat(west)  && elLon <= parseFloat(east);
        const displayLat = (el.type === 'relation' && !inBbox) ? bboxCenterLat : elLat;
        const displayLon = (el.type === 'relation' && !inBbox) ? bboxCenterLon : elLon;

        return {
          id: el.id,
          category: decor.name,
          icon: decor.icon,
          image: decor.image,
          mapIcon: decor.mapIcon,
          color: decor.color,
          name: el.tags.name || decor.name,
          lat: displayLat,
          lon: displayLon
        };
      })
      .filter(Boolean);

    const elapsed = Date.now() - startTime;
    const bboxStr = `${south},${west},${north},${east}`;
    logOverpassMetric({ type: 'browse', durationMs: elapsed, success: true, elements: results.length, bbox: bboxStr, categories: [category] });
    res.json({ results, total: results.length, queryTimeMs: elapsed });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const bboxStr = `${south},${west},${north},${east}`;
    logOverpassMetric({ type: 'browse', durationMs: elapsed, success: false, error: error.message, bbox: bboxStr, categories: [category] });

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return res.status(504).json({
        error: 'Query was too large and timed out. Please zoom in and try again.',
        queryTimeMs: elapsed
      });
    }
    if (error.response?.status === 429) {
      return res.status(429).json({ error: 'Rate limited. Please wait a moment.' });
    }
    res.status(500).json({ error: 'Browse failed: ' + error.message });
  }
});

/**
 * GET /api/decor-browse-multi?south=...&west=...&north=...&east=...&categories=cat1,cat2,...
 *
 * Find all locations of multiple decor types within a map bounding box in a
 * single Overpass query. Used by the Browse tab's "Refresh view" button.
 *
 * Query params:
 *   south, west, north, east (required) - Bounding box coordinates
 *   categories (required)               - Comma-separated decor category names
 *
 * Returns: { byCategory: { [name]: DecorResult[] }, total: number, queryTimeMs: number }
 */
router.get('/decor-browse-multi', async (req, res) => {
  const { south, west, north, east, categories } = req.query;

  if (!south || !west || !north || !east || !categories) {
    return res.status(400).json({ error: 'south, west, north, east, and categories are required' });
  }

  const decorNames = categories.split(',').map(s => s.trim()).filter(Boolean);
  if (decorNames.length === 0) {
    return res.status(400).json({ error: 'No valid categories provided' });
  }

  const startTime = Date.now();
  debug('Decor browse-multi for:', decorNames, 'in bbox:', south, west, north, east);

  try {
    const query = buildOverpassBboxQueryMulti(
      parseFloat(south), parseFloat(west),
      parseFloat(north), parseFloat(east),
      decorNames
    );

    if (!query) {
      return res.status(400).json({ error: 'No valid categories found' });
    }

    const elements = await queryOverpass(query, 30000);

    // Pre-build lookup map for the requested decors
    const decorByName = {};
    DECOR_MAPPINGS.filter(d => decorNames.includes(d.name)).forEach(d => { decorByName[d.name] = d; });

    const byCategory = {};
    decorNames.forEach(name => { byCategory[name] = []; });

    const seen = new Set();
    const bboxCLat = (parseFloat(south) + parseFloat(north)) / 2;
    const bboxCLon = (parseFloat(west) + parseFloat(east)) / 2;

    elements
      .filter(el => el.tags)
      .forEach(el => {
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        if (!elLat || !elLon) return;

        const inBbox = elLat >= parseFloat(south) && elLat <= parseFloat(north) &&
                       elLon >= parseFloat(west)  && elLon <= parseFloat(east);
        const displayLat = (el.type === 'relation' && !inBbox) ? bboxCLat : elLat;
        const displayLon = (el.type === 'relation' && !inBbox) ? bboxCLon : elLon;

        matchDecorCategories(el.tags)
          .filter(decor => decorByName[decor.name])
          .forEach(decor => {
            const key = `${decor.name}-${el.id}`;
            if (seen.has(key)) return;
            seen.add(key);
            byCategory[decor.name].push({
              id: el.id,
              category: decor.name,
              icon: decor.icon,
              image: decor.image,
              mapIcon: decor.mapIcon,
              color: decor.color,
              name: el.tags.name || decor.name,
              lat: displayLat,
              lon: displayLon
            });
          });
      });

    const total = Object.values(byCategory).reduce((sum, arr) => sum + arr.length, 0);
    const elapsed = Date.now() - startTime;
    debug('Decor browse-multi completed in', elapsed, 'ms, found', total, 'results');

    const bboxStr = `${south},${west},${north},${east}`;
    logOverpassMetric({ type: 'browse-multi', durationMs: elapsed, success: true, elements: total, bbox: bboxStr, categories: decorNames });

    res.json({ byCategory, total, queryTimeMs: elapsed });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const bboxStr = `${south},${west},${north},${east}`;
    logOverpassMetric({ type: 'browse-multi', durationMs: elapsed, success: false, error: error.message, bbox: bboxStr, categories: decorNames });

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return res.status(504).json({
        error: 'Query was too large and timed out. Please zoom in and try again.',
        queryTimeMs: elapsed
      });
    }
    if (error.response?.status === 429) {
      return res.status(429).json({ error: 'Rate limited. Please wait a moment.' });
    }
    res.status(500).json({ error: 'Browse refresh failed: ' + error.message });
  }
});

/**
 * GET /api/categories
 *
 * Return the full list of known decor categories with their icon and color.
 * Used to populate the category grid in the Browse tab and the filter checkboxes.
 *
 * Returns: Array of { name, icon, color }
 */
router.get('/categories', (req, res) => {
  res.json(DECOR_MAPPINGS.map(d => ({
    name: d.name,
    icon: d.icon,
    image: d.image,
    mapIcon: d.mapIcon,
    color: d.color
  })));
});

module.exports = router;
