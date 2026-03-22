/**
 * Pikmin Bloom Decor Mappings
 *
 * Maps OpenStreetMap (OSM) tags to Pikmin Bloom decor categories.
 * Each entry in DECOR_MAPPINGS describes one in-game decor type and which
 * OSM key/value pairs indicate that a real-world place belongs to that type.
 *
 * Sources: Pikipedia, PikminDecorPredictor, pixlpirate/pikmin-map
 *
 * Data structure for each mapping:
 *   name   - Must match the in-game decor name exactly
 *   icon   - Emoji fallback (kept for backwards-compat; UI now prefers `image`)
 *   image  - Filename of the decor sprite in public/images/ (e.g. "Decor Red Chef Hat.png")
 *   color  - Hex color for map markers and UI accents
 *   tags   - Array of { key, value } OSM tag pairs (OR logic — any match counts)
 *
 * Double-decor: A single OSM element can match multiple entries (e.g. a bakery
 * tagged cuisine=pretzel also matches the Bakery category). matchDecorCategories()
 * returns all matches, and the UI handles the overlap.
 *
 * Accuracy caveat: Pikmin Bloom pulls from multiple data sources (OSM, Foursquare,
 * Yelp, Google Places) and may be using OSM data that is years out of date.
 * Results from this tool (which queries live OSM data) will sometimes differ
 * from what appears in the game.
 */

/** The game's fixed detector radius in meters. Pikmin within this range of a
 *  decor-generating location will receive that location's decoration. */
const DETECTOR_RANGE = 100;

const DECOR_MAPPINGS = [
  // ========== FOOD & DRINK ==========
  {
    name: 'Restaurant',
    icon: '👨‍🍳',
    image: 'Decor Ice Chef Hat.png',     // Ice — only color available for Chef Hat
    mapIcon: 'MapIcon_Restaurant.png',
    color: '#E74C3C',
    tags: [{ key: 'amenity', value: 'restaurant' }]
  },
  {
    name: 'Café',
    icon: '☕',
    image: 'Decor Yellow Coffee Cup.png',
    mapIcon: 'MapIcon_Cafe.png',
    color: '#8B4513',
    tags: [
      { key: 'amenity', value: 'cafe' },
      { key: 'cuisine', value: 'coffee_shop' }
    ]
  },
  {
    name: 'Sweetshop',
    icon: '🍩',
    image: 'Decor Winged Donut.png',
    mapIcon: 'MapIcon_Doughnut.png',
    color: '#FF69B4',
    tags: [
      { key: 'shop', value: 'pastry' },
      { key: 'shop', value: 'confectionery' }
    ]
  },
  {
    name: 'Bakery',
    icon: '🥖',
    image: 'Decor Red Baguette.png',
    mapIcon: 'MapIcon_Bakery.png',
    color: '#D4A574',
    tags: [
      { key: 'shop', value: 'bakery' },
      { key: 'cuisine', value: 'pretzel' }
    ]
  },
  {
    name: 'Burger Place',
    icon: '🍔',
    image: 'Decor Red Burger.png',
    mapIcon: 'MapIcon_Hamburger.png',
    color: '#F39C12',
    tags: [
      { key: 'amenity', value: 'fast_food' },
      { key: 'cuisine', value: 'burger' }
    ]
  },
  {
    name: 'Supermarket',
    icon: '🍌',
    image: 'Decor Yellow Banana.png',
    mapIcon: 'MapIcon_Supermarket.png',
    color: '#FFE135',
    tags: [{ key: 'shop', value: 'supermarket' }]
  },
  {
    name: 'Corner Store',
    icon: '🏪',
    image: 'Decor Purple Snack.png',
    mapIcon: 'MapIcon_ConvenienceStore.png',
    color: '#FF9800',
    tags: [{ key: 'shop', value: 'convenience' }]
  },

  // ========== CUISINE TYPES ==========
  {
    name: 'Sushi Restaurant',
    icon: '🍣',
    image: 'Decor White Sushi.png',
    mapIcon: 'MapIcon_SushiRestaurant.png',
    color: '#FF6B6B',
    tags: [{ key: 'cuisine', value: 'sushi' }]
  },
  {
    name: 'Italian Restaurant',
    icon: '🍕',
    image: 'Decor Winged Pasta.png',
    mapIcon: 'MapIcon_ItalianRestaurant.png',
    color: '#27AE60',
    tags: [
      { key: 'cuisine', value: 'pizza' },
      { key: 'cuisine', value: 'pasta' },
      { key: 'cuisine', value: 'italian' }
    ]
  },
  {
    name: 'Ramen Restaurant',
    icon: '🍜',
    image: 'Decor Red Ramen Keychain.png',
    mapIcon: 'MapIcon_RamenRestaurant.png',
    color: '#E67E22',
    tags: [
      { key: 'cuisine', value: 'chinese' },
      { key: 'cuisine', value: 'noodle' },
      { key: 'cuisine', value: 'ramen' },
      { key: 'cuisine', value: 'udon' },
      { key: 'cuisine', value: 'soba' }
    ]
  },
  {
    name: 'Curry Restaurant',
    icon: '🍛',
    image: 'Decor Yellow Curry Bowl.png',
    mapIcon: 'MapIcon_Curry.png',
    color: '#D35400',
    tags: [
      { key: 'cuisine', value: 'curry' },
      { key: 'cuisine', value: 'indian' },
      { key: 'cuisine', value: 'nepalese' }
    ]
  },
  {
    name: 'Mexican Restaurant',
    icon: '🌮',
    image: 'Decor Winged Taco.png',
    mapIcon: 'MapIcon_MexicanRestaurant.png',
    color: '#E74C3C',
    tags: [
      { key: 'cuisine', value: 'mexican' },
      { key: 'cuisine', value: 'tex-mex' }
    ]
  },
  {
    name: 'Korean Restaurant',
    icon: '🥬',
    image: 'Decor Purple Kimchi.png',   // Purple — only color available for Kimchi
    mapIcon: 'MapIcon_KoreanRestaurant.png',
    color: '#E91E63',
    tags: [{ key: 'cuisine', value: 'korean' }]
  },

  // ========== NATURE ==========
  {
    name: 'Forest',
    icon: '🌲',
    image: 'Decor Blue Acorn.png',
    mapIcon: 'MapIcon_Forest.png',
    color: '#228B22',
    tags: [
      { key: 'natural', value: 'wood' },
      { key: 'landuse', value: 'forest' }
    ]
  },
  {
    name: 'Waterside',
    icon: '🎣',
    image: 'Decor Blue Fishing Lure.png',
    mapIcon: 'MapIcon_Water.png',
    color: '#3498DB',
    tags: [{ key: 'natural', value: 'water' }]
  },
  {
    name: 'Beach',
    icon: '🏖️',
    image: 'Decor White Shell.png',
    mapIcon: 'MapIcon_Beach.png',
    color: '#F4D03F',
    tags: [{ key: 'natural', value: 'beach' }]
  },
  {
    name: 'Mountain',
    icon: '⛰️',
    image: 'Decor Rock Mountain Pin Badge.png',
    mapIcon: 'MapIcon_Mountain.png',
    color: '#7F8C8D',
    tags: [{ key: 'natural', value: 'peak' }]
  },
  {
    name: 'Park',
    icon: '🍀',
    image: 'Decor Blue Clover.png',
    mapIcon: 'MapIcon_Park.png',
    color: '#32CD32',
    tags: [{ key: 'leisure', value: 'park' }]
  },

  // ========== TRANSPORTATION ==========
  {
    name: 'Airport',
    icon: '✈️',
    image: 'Decor Yellow Golden Toy Airplane.png', // Yellow — only color available
    mapIcon: 'MapIcon_AirPort.png',
    color: '#5DADE2',
    tags: [
      { key: 'aeroway', value: 'aerodrome' },
      { key: 'aeroway', value: 'heliport' }
    ]
  },
  {
    name: 'Station',
    icon: '🚂',
    image: 'Decor Purple Paper Train.png',
    mapIcon: 'MapIcon_Station.png',
    color: '#1ABC9C',
    tags: [
      { key: 'railway', value: 'station' },
      { key: 'building', value: 'train_station' }
    ]
  },
  {
    name: 'Bus Stop',
    icon: '🚌',
    image: 'Decor Rock Bus Papercraft.png',
    mapIcon: 'MapIcon_BusStop.png',
    color: '#9B59B6',
    tags: [{ key: 'highway', value: 'bus_stop' }]
  },
  {
    name: 'Bridge',
    icon: '🌉',
    image: 'Decor Rock Bridge Pin Badge.png',
    mapIcon: 'MapIcon_Bridge.png',
    color: '#95A5A6',
    tags: [
      { key: 'bridge', value: 'yes' },
      { key: 'bridge', value: 'viaduct' }
    ]
  },

  // ========== ENTERTAINMENT ==========
  {
    name: 'Movie Theater',
    icon: '🍿',
    image: 'Decor Purple Popcorn Snack.png',
    mapIcon: 'MapIcon_Theatre.png',
    color: '#C0392B',
    tags: [{ key: 'amenity', value: 'cinema' }]
  },
  {
    name: 'Zoo',
    icon: '🦁',
    image: 'Decor Ice Stag Beetle.png',          // Ice — only color available
    mapIcon: 'MapIcon_Zoo.png',
    color: '#F1C40F',
    tags: [{ key: 'tourism', value: 'zoo' }]
  },
  {
    name: 'Theme Park',
    icon: '🎢',
    image: 'Decor Blue Theme Park Ticket 1.png',
    mapIcon: 'MapIcon_AmusementPark.png',
    color: '#E91E63',
    tags: [{ key: 'tourism', value: 'theme_park' }]
  },
  {
    name: 'Stadium',
    icon: '🏟️',
    image: 'Decor Yellow Rosette.png',
    mapIcon: 'MapIcon_Stadium.png',
    color: '#2ECC71',
    tags: [{ key: 'leisure', value: 'stadium' }]
  },

  // ========== SERVICES ==========
  {
    name: 'Pharmacy',
    icon: '💊',
    image: 'Decor White Toothbrush.png',
    mapIcon: 'MapIcon_Pharmacy.png',
    color: '#00BCD4',
    tags: [{ key: 'amenity', value: 'pharmacy' }]
  },
  {
    name: 'Post Office',
    icon: '📮',
    image: 'Decor Red Stamp.png',
    mapIcon: 'MapIcon_Posts.png',
    color: '#FF5722',
    tags: [{ key: 'amenity', value: 'post_office' }]
  },
  {
    name: 'Library & Bookstore',
    icon: '📚',
    image: 'Decor Rock Tiny Book.png',
    mapIcon: 'MapIcon_Library.png',
    color: '#795548',
    tags: [
      { key: 'amenity', value: 'library' },
      { key: 'shop', value: 'books' }
    ]
  },
  {
    name: 'Hair Salon',
    icon: '✂️',
    image: 'Decor Winged Scissors.png',
    mapIcon: 'MapIcon_Salon.png',
    color: '#FF4081',
    tags: [{ key: 'shop', value: 'hairdresser' }]
  },
  {
    name: 'Hotel',
    icon: '🏨',
    image: 'Decor Purple Hotel Amenities.png',
    mapIcon: 'MapIcon_Hotel.png',
    color: '#673AB7',
    tags: [{ key: 'tourism', value: 'hotel' }]
  },
  {
    name: 'University',
    icon: '🎓',
    image: 'Decor Blue College Crest Patch.png',
    mapIcon: 'MapIcon_Crest.png', 
    color: '#3F51B5',
    tags: [
      { key: 'amenity', value: 'university' },
      { key: 'amenity', value: 'college' },
      { key: 'building', value: 'university' }
    ]
  },
  {
    name: 'Laundry',
    icon: '🧺',
    image: 'Decor White Laundry Item.png',
    mapIcon: 'MapIcon_Laundry.png',  
    color: '#00BCD4',
    tags: [
      { key: 'shop', value: 'laundry' },
      { key: 'shop', value: 'dry_cleaning' }
    ]
  },

  // ========== SHOPPING ==========
  {
    name: 'Art Gallery',
    icon: '🎨',
    image: 'Decor Purple Paint.png',
    mapIcon: 'MapIcon_Museum.png',
    color: '#9C27B0',
    tags: [
      { key: 'shop', value: 'art' },
      { key: 'tourism', value: 'museum' }
    ]
  },
  {
    name: 'Clothes Store',
    icon: '👕',
    image: 'Decor Winged Sneaker Keychain.png',
    mapIcon: 'MapIcon_ClosthingStore.png',
    color: '#E91E63',
    tags: [
      { key: 'shop', value: 'clothes' },
      { key: 'shop', value: 'shoes' }
    ]
  },
  {
    name: 'Makeup Store',
    icon: '💄',
    image: 'Decor White Makeup.png',
    mapIcon: 'MapIcon_Cosme.png',
    color: '#9C27B0',
    tags: [
      { key: 'shop', value: 'department_store' },
      { key: 'shop', value: 'cosmetics' },
      { key: 'amenity', value: 'pharmacy' }
    ]
  },
  {
    name: 'Appliances Store',
    icon: '📱',
    image: 'Decor Yellow Battery 1.png',          // Yellow — only color available
    mapIcon: 'MapIcon_Electronics.png',
    color: '#607D8B',
    tags: [
      { key: 'shop', value: 'appliance' },
      { key: 'shop', value: 'computer' },
      { key: 'shop', value: 'electronics' }
    ]
  },
  {
    name: 'Hardware Store',
    icon: '🔧',
    image: 'Decor Rock Tool.png',
    mapIcon: 'MapIcon_HardwareStore.png',
    color: '#FF5722',
    tags: [
      { key: 'shop', value: 'doityourself' },
      { key: 'shop', value: 'hardware' }
    ]
  },

  // ========== SPECIAL ==========
  {
    name: 'Shrines & Temples',
    icon: '⛩️',
    image: 'Decor Red Fortune 1.png',
    mapIcon: 'MapIcon_Omikuji.png',
    color: '#D32F2F',
    // Compound AND-logic groups: all tags within a group must match.
    // Groups are OR'd together. Mirrors pikmin-map's behaviour: requires
    // both building type AND religion to be tagged, which avoids false
    // positives from churches, mosques, etc. tagged amenity=place_of_worship.
    tagGroups: [
      [{ key: 'building', value: 'shrine'  }, { key: 'religion', value: 'shinto'   }],
      [{ key: 'building', value: 'shrine'  }, { key: 'religion', value: 'buddhist' }],
      [{ key: 'building', value: 'temple'  }, { key: 'religion', value: 'shinto'   }],
      [{ key: 'building', value: 'temple'  }, { key: 'religion', value: 'buddhist' }],
    ]
  }
];

/**
 * Build Overpass query for all decor types within detector range.
 *
 * Handles two tag matching modes:
 *   tags      – simple OR logic: any single tag match counts
 *   tagGroups – compound AND logic: every tag in a group must match;
 *               groups themselves are OR'd (e.g. Shrines & Temples)
 */
function buildOverpassQuery(lat, lon, radius = DETECTOR_RANGE) {
  const tagsByKey = {};
  const compoundLines = [];

  DECOR_MAPPINGS.forEach(decor => {
    (decor.tags || []).forEach(tag => {
      if (!tagsByKey[tag.key]) tagsByKey[tag.key] = new Set();
      tagsByKey[tag.key].add(tag.value);
    });

    (decor.tagGroups || []).forEach(group => {
      const predicates = group.map(t => `["${t.key}"="${t.value}"]`).join('');
      compoundLines.push(`nwr${predicates}(around:${radius},${lat},${lon});`);
    });
  });

  const tagQueries = [];
  for (const [key, values] of Object.entries(tagsByKey)) {
    const valueArray = Array.from(values);
    if (valueArray.length === 1) {
      tagQueries.push(`nwr["${key}"="${valueArray[0]}"](around:${radius},${lat},${lon});`);
    } else {
      const regexPattern = valueArray.map(v => v.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
      tagQueries.push(`nwr["${key}"~"^(${regexPattern})$"](around:${radius},${lat},${lon});`);
    }
  }

  return `
[out:json][timeout:30];
(
  ${[...tagQueries, ...compoundLines].join('\n  ')}
);
out center tags qt;
  `.trim();
}

/**
 * Match OSM element tags to ALL matching decor categories.
 * Returns an array of all decor types that match (supports double/multi-decor).
 * Handles semicolon-delimited OSM values (e.g. cuisine=pizza;burger).
 */
function matchDecorCategories(tags) {
  // Expand semicolon-delimited OSM values into flat key→[values] map
  const expandedValues = {};
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value === 'string') {
      expandedValues[key] = value.split(';').map(v => v.trim());
    }
  }

  const matches = [];
  for (const decor of DECOR_MAPPINGS) {
    let matched = false;

    // Simple OR tags: any single tag match is enough
    for (const decorTag of (decor.tags || [])) {
      const tagValues = expandedValues[decorTag.key];
      if (tagValues && tagValues.includes(decorTag.value)) {
        matched = true;
        break;
      }
    }

    // Compound AND tag groups: every tag in a group must match; groups are OR'd
    if (!matched) {
      for (const group of (decor.tagGroups || [])) {
        if (group.every(t => {
          const vals = expandedValues[t.key];
          return vals && vals.includes(t.value);
        })) {
          matched = true;
          break;
        }
      }
    }

    if (matched) matches.push(decor);
  }
  return matches;
}

/**
 * Build Overpass query for a specific decor type within a bounding box.
 * Used by the "Browse by Decor" tab to find all instances in the current viewport.
 */
function buildOverpassBboxQuery(south, west, north, east, decorName) {
  const decor = DECOR_MAPPINGS.find(d => d.name === decorName);
  if (!decor) return null;

  const bbox = `${south},${west},${north},${east}`;

  const tagQueries = (decor.tags || []).map(tag =>
    `nwr["${tag.key}"="${tag.value}"](${bbox});`
  );

  const compoundLines = (decor.tagGroups || []).map(group => {
    const predicates = group.map(t => `["${t.key}"="${t.value}"]`).join('');
    return `nwr${predicates}(${bbox});`;
  });

  return `
[out:json][timeout:30];
(
  ${[...tagQueries, ...compoundLines].join('\n  ')}
);
out center tags qt;
  `.trim();
}

/**
 * Build a single Overpass query for multiple decor types within a bounding box.
 * Deduplicates tag queries across categories so the same OSM key/value pair
 * is only fetched once even if several selected decors share it.
 * Used by the "Refresh view" button on the Browse tab.
 */
function buildOverpassBboxQueryMulti(south, west, north, east, decorNames) {
  const relevantDecors = DECOR_MAPPINGS.filter(d => decorNames.includes(d.name));
  if (relevantDecors.length === 0) return null;

  const bbox = `${south},${west},${north},${east}`;
  const tagsByKey = {};
  const compoundLines = new Set(); // deduplicate identical compound queries

  relevantDecors.forEach(decor => {
    (decor.tags || []).forEach(tag => {
      if (!tagsByKey[tag.key]) tagsByKey[tag.key] = new Set();
      tagsByKey[tag.key].add(tag.value);
    });

    (decor.tagGroups || []).forEach(group => {
      const predicates = group.map(t => `["${t.key}"="${t.value}"]`).join('');
      compoundLines.add(`nwr${predicates}(${bbox});`);
    });
  });

  const tagQueries = [];
  for (const [key, values] of Object.entries(tagsByKey)) {
    const valueArray = Array.from(values);
    if (valueArray.length === 1) {
      tagQueries.push(`nwr["${key}"="${valueArray[0]}"](${bbox});`);
    } else {
      const regexPattern = valueArray.map(v => v.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
      tagQueries.push(`nwr["${key}"~"^(${regexPattern})$"](${bbox});`);
    }
  }

  return `
[out:json][timeout:30];
(
  ${[...tagQueries, ...compoundLines].join('\n  ')}
);
out center tags qt;
  `.trim();
}

// Expose as globals for browser use (no module system)
window.DECOR_MAPPINGS = DECOR_MAPPINGS;
window.DETECTOR_RANGE = DETECTOR_RANGE;
window.buildOverpassQuery = buildOverpassQuery;
window.buildOverpassBboxQuery = buildOverpassBboxQuery;
window.buildOverpassBboxQueryMulti = buildOverpassBboxQueryMulti;
window.matchDecorCategories = matchDecorCategories;
