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

Thank you to [pixlpirate's pikmin map](https://github.com/pixlpirate/pikmin-map) project for already sorting out how the game interprets OSM data. To avoid re-inventing the wheel, I referenced this data when mapping the decor to OSM tags.

`decor-mappings.js` contains 34 decor categories, each mapping one or more OSM tag.

Example:
```js
{
    name: 'Bakery',
    image: 'Decor Red Baguette.png',
    mapIcon: 'MapIcon_Bakery.png',
    color: '#D4A574',
    tags: [
      { key: 'shop', value: 'bakery' },
      { key: 'cuisine', value: 'pretzel' }
    ]
  }
```

A location matches the **Bakery** category if it has `shop=bakery` **or** `cuisine=pretzel`. One location can match multiple categories, which the UI handles by showing multiple types on a single (expanded) pin on the map. The sidebar also shows more detailed information about locations, including each decor type it satisfies.

To add or adjust a category, edit the `DECOR_MAPPINGS` array. OSM tag reference: [taginfo.openstreetmap.org](https://taginfo.openstreetmap.org/)

---

## Accuracy notes

- This tool uses **live OSM data**. Pikmin Bloom uses OSM data that may be years out of date, so results can differ from the game.
- Pikmin Bloom also pulls from Foursquare, but this data is not accessible, and even if it were, it would be impossible to calibrate without being able to see the game's source code. Most of the game data seems to come from OSM anyway.
- The game's detector range is **100 meters** (`DETECTOR_RANGE` in `decor-mappings.js`).
