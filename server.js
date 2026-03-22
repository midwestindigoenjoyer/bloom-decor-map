/**
 * Pikmin Decor Map — Express server
 *
 * Thin entry point: wires up middleware, routes, and starts the server.
 *
 * Routes are split by concern:
 *   routes/geocode.js  — address search and autocomplete (Nominatim)
 *   routes/decor.js    — decor lookup, viewport browse, and category list (Overpass)
 *
 * Utilities:
 *   utils/nominatim.js — Nominatim API client with rate limiting
 *   utils/overpass.js  — Overpass API client with server fallback
 *   utils/haversine.js — Great-circle distance calculation
 *
 * Set DEBUG=true to enable verbose request logging.
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the legacy vanilla-JS client from the public/ directory
app.use(express.static(path.join(__dirname, 'public')));

// Route handlers
app.use('/api', require('./routes/geocode'));
app.use('/api', require('./routes/decor'));

/**
 * GET /api/health
 * Simple health check — useful for monitoring and smoke tests.
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Pikmin Decor Map running at http://localhost:${PORT}`);
  if (process.env.DEBUG === 'true') {
    console.log('Debug mode enabled');
  }
});
