# Pikmin Decor Map

An interactive map for  Pikmin Bloom decor locations.

Queries OpenStreetMap data to show which decor types are available at a given location on the map.

---

## How it works

1. Search an address or click/tap the map.
2. The server queries the [Overpass API](https://overpass-api.de/) for OSM elements near that point.
3. Each element's tags are matched against decor category definitions.
4. Matching locations are rendered on the map, with a results list sorted by distance.

You can also pick a decor type first and see all matching locations in the current map viewport.

---

## Project structure

```
pikmin/
├── server.js              # Express entry point — wires routes and starts server
├── decor-mappings.js      # Core data: OSM tag → Pikmin decor category definitions
├── scrape-images.js       # One-time script to download decor images from pikminwiki.com
│
├── routes/
│   ├── geocode.js         # /api/geocode and /api/autocomplete (Nominatim)
│   └── decor.js           # /api/decor, /api/decor-browse, /api/categories (Overpass)
│
├── utils/
│   ├── nominatim.js       # Nominatim API client with 1 req/sec rate limiting
│   ├── overpass.js        # Overpass API client with automatic server fallback
│   └── haversine.js       # Great-circle distance calculation (degrees → meters)
│
└── public/
    ├── app.js             # Vanilla JS frontend (single HTML page client)
    └── images/            # ~891 decor PNG sprites scraped from pikminwiki.com
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/decor?lat=&lon=&radius=` | Find all decor types near a point (default radius: 200m) |
| GET | `/api/decor-browse?south=&west=&north=&east=&category=` | All locations of one decor type in a bounding box |
| GET | `/api/categories` | Full list of decor categories with icons and colors |
| GET | `/api/geocode?address=` | Convert an address string to lat/lon (Nominatim) |
| GET | `/api/autocomplete?q=` | Address autocomplete suggestions (min 3 chars) |
| GET | `/api/health` | Health check — returns `{ status: "ok" }` |

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+

### Install and run

```bash
npm install
npm start
```

The server starts on `http://localhost:3000` by default. Set `PORT` to change it.

Enable verbose request/response logging with `DEBUG=true`:

```bash
DEBUG=true npm start
```

---

## Decor mappings

`decor-mappings.js` is the heart of the project. It contains 34 decor categories, each mapping one or more OSM tag `key=value` pairs to a Pikmin Bloom decor type.

Example:
```js
{
  name: 'Café',
  icon: '☕',
  color: '#8B4513',
  tags: [
    { key: 'amenity', value: 'cafe' },
    { key: 'cuisine', value: 'coffee_shop' }
  ]
}
```

A location matches the **Café** category if it has `amenity=cafe` **or** `cuisine=coffee_shop`. One location can match multiple categories (double-decor), which the UI handles by showing multiple emoji on a single pin.

To add or adjust a category, edit the `DECOR_MAPPINGS` array. OSM tag reference: [taginfo.openstreetmap.org](https://taginfo.openstreetmap.org/)

---

## Accuracy notes

- This tool uses **live OSM data**. Pikmin Bloom uses OSM data that may be years out of date, so results can differ from the game.
- Pikmin Bloom also pulls from Foursquare, but this data is not accessible, and even if it were, it would be impossible to calibrate without being able to see the game's source code. Most of the game data seems to come from OSM anyway.
- The game's detector range is **100 meters** (`DETECTOR_RANGE` in `decor-mappings.js`). The default search radius is wider (200m) so you can see what's nearby and plan your route.
