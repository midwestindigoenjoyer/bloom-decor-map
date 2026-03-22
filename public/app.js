/**
 * Pikmin Bloom Decor Map
 * Interactive map to discover decor zones
 */

// Configuration
const SEARCH_RADIUS = 100;

// ===========================
// Haversine distance
// ===========================
const EARTH_RADIUS_METERS = 6371000;
function calculateDistance(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ===========================
// Overpass API (with fallback server)
// ===========================
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

async function queryOverpass(query, timeoutMs = 45000) {
  let lastError;
  for (const server of OVERPASS_SERVERS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(server, {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain' },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`Overpass error: HTTP ${response.status}`);
      const data = await response.json();
      return data.elements || [];
    } catch (err) {
      lastError = err;
    }
  }
  const err = lastError?.name === 'AbortError'
    ? new Error('Request timed out.')
    : lastError;
  if (lastError?.name === 'AbortError') err.isTimeout = true;
  throw err;
}

// ===========================
// Nominatim geocoding
// ===========================
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const NOMINATIM_EMAIL = 'bloomdecormap@proton.me';

async function nominatimSearch(params, signal) {
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('email', NOMINATIM_EMAIL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) throw new Error(`Nominatim error: HTTP ${response.status}`);
  return response.json();
}

async function nominatimGeocode(address) {
  const data = await nominatimSearch({ q: address, limit: 1 });
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display_name: data[0].display_name };
}

async function nominatimAutocomplete(q, signal) {
  if (!q || q.length < 3) return [];
  const data = await nominatimSearch({ q, limit: 5, addressdetails: 1 }, signal);
  return data.map(r => ({ display_name: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon) }));
}

// Pin icon priority for double-decor locations. Higher number = shown last
// (lowest priority). 0 = specific/preferred; unlisted categories default to 0.
const DECOR_CATEGORY_PRIORITY = { 'Burger Place': 1, 'Restaurant': 2, 'Café': 2 };

// State
let map;
let searchMarker = null;
let decorMarkers = [];
let decorMarkersMap = {};  // "lat_lon" -> Leaflet marker, for list-click selection
let radiusCircle = null;
let activeTab = 'search';
let autocompleteTimer = null;
let autocompleteController = null;  // AbortController for in-flight Nominatim requests
let pendingRetryFn = null;          // Stored callback for the timeout modal "Try Again"
let _suppressHideLoading = false;   // Prevents finally{hideLoading()} from closing the timeout modal
let activeBrowseCategories = new Set();  // multi-select
let browseResultsData = {};  // category -> results array
let lastSearchLat = null;
let lastSearchLon = null;
let isLoading = false;  // true while any Overpass query is in-flight

// DOM Elements
const sidebar = document.getElementById('sidebar');
const addressInput = document.getElementById('address-input');
const searchBtn = document.getElementById('search-btn');
const locateBtn = document.getElementById('locate-btn');
const resultsSection = document.getElementById('results-section');
const decorSummary = document.getElementById('decor-summary');
const resultsContent = document.getElementById('results-content');
const resultsLocation = document.getElementById('results-location');
const resultsCount = document.getElementById('results-count');
const emptyState = document.getElementById('empty-state');
const loading = document.getElementById('loading');
const loadingNormal = document.getElementById('loading-normal');
const loadingTimeout = document.getElementById('loading-timeout');
const autocompleteList = document.getElementById('autocomplete-list');
const browseGrid = document.getElementById('browse-grid');
const browseResults = document.getElementById('browse-results');
const browseResultsLabel = document.getElementById('browse-results-label');
const browseResultsCount = document.getElementById('browse-results-count');
const browseResultsContent = document.getElementById('browse-results-content');
const browseClearBtn = document.getElementById('browse-clear-btn');
const browseRefreshBtn = document.getElementById('browse-refresh-btn');
const mapBrowseActionsEl = document.getElementById('map-browse-actions');
const sheetTab = document.getElementById('sheet-tab');
const sidebarToggle = document.getElementById('sidebar-toggle');

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
  initMap();
  bindEvents();
  loadBrowseGrid();

  // On mobile, start with the sidebar visible (mid state) — no animation on load.
  // Auto-geolocation removed; user can tap "Use my location" if desired.
  if (window.innerWidth <= 768) {
    sidebar.style.transition = 'none';
    sidebar.classList.add('mid');
    void sidebar.offsetHeight;   // flush so the class takes effect before re-enabling
    sidebar.style.transition = '';
    updateTabVisibility('mid');
  }
}

// ===========================
// Map Initialization
// ===========================
function initMap() {
  map = L.map('map', {
    center: [40.7128, -74.0060], // NYC default
    zoom: 15,
    zoomControl: true,
    attributionControl: true
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/">CARTO</a>',
    maxZoom: 20
  }).addTo(map);

  map.zoomControl.setPosition('bottomright');
  map.on('click', handleMapClick);

  // Scale pins down when zoomed out — pins are full-size at zoom 18+,
  // half-size below that so they don't overwhelm the map at low zoom.
  map.on('zoomend', () => {
    map.getContainer().classList.toggle('map-zoomed-out', map.getZoom() < 17);
    updateBrowseZoomState();
  });

  // Apply correct size class immediately so first batch of markers renders
  // at the right size without needing a zoom interaction.
  map.getContainer().classList.toggle('map-zoomed-out', map.getZoom() < 17);
  updateBrowseZoomState();
}

// ===========================
// Geolocation on Load
// ===========================
function requestGeolocation() {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      zoomToSearchArea(latitude, longitude);
      placeSearchMarker(latitude, longitude);
      resultsLocation.textContent = '📍 Your Location';

      if (activeTab === 'search') {
        await fetchDecor(latitude, longitude);
      }
    },
    () => {
      // Permission denied or error - keep default NYC location, do nothing
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// ===========================
// Event Bindings
// ===========================
function bindEvents() {
  // Search
  searchBtn.addEventListener('click', handleSearch);
  addressInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      autocompleteList.classList.add('hidden');
      handleSearch();
    }
  });

  // Autocomplete
  addressInput.addEventListener('input', handleAutocompleteInput);
  addressInput.addEventListener('focus', () => {
    if (autocompleteList.children.length > 0) {
      autocompleteList.classList.remove('hidden');
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-area')) {
      autocompleteList.classList.add('hidden');
    }
  });

  // Geolocation
  locateBtn.addEventListener('click', handleLocate);

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Pull-up tab — shown when sidebar is off-screen
  if (sheetTab) sheetTab.addEventListener('click', () => snapSheet('mid'));

  // Timeout modal
  document.getElementById('loading-retry-btn').addEventListener('click', () => {
    hideLoading();
    if (pendingRetryFn) { const fn = pendingRetryFn; pendingRetryFn = null; fn(); }
  });
  document.getElementById('loading-cancel-btn').addEventListener('click', () => {
    hideLoading();
    pendingRetryFn = null;
  });

  // Browse clear / refresh (sidebar on desktop, map overlay on mobile)
  browseClearBtn.addEventListener('click', clearBrowseAll);
  browseRefreshBtn.addEventListener('click', refreshBrowseViewport);
  document.getElementById('map-browse-clear-btn').addEventListener('click', clearBrowseAll);
  document.getElementById('map-browse-refresh-btn').addEventListener('click', refreshBrowseViewport);

  // Sidebar toggle (desktop)
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('sidebar-collapsed');
    });
  }

  // Invalidate map size after sidebar collapses/expands so tiles fill correctly.
  sidebar.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'transform' || e.propertyName === 'top') map.invalidateSize();
  });
  window.addEventListener('resize', () => map.invalidateSize());

  // Mobile bottom sheet — drag from handle or header (not buttons/inputs)
  const sheetHandle = document.getElementById('sheet-handle');
  const sidebarHeader = document.getElementById('sidebar-header');
  if (sheetHandle) sheetHandle.addEventListener('touchstart', handleSheetDragStart, { passive: true });
  if (sidebarHeader) {
    sidebarHeader.addEventListener('touchstart', (e) => {
      if (!e.target.closest('button, input')) handleSheetDragStart(e);
    }, { passive: true });
  }

  // Any interaction (focus, tap) inside the sidebar snaps it back to mid
  sidebar.addEventListener('focusin', () => {
    if (window.innerWidth <= 768 && getSheetState() === 'peek') snapSheet('mid');
  });

  // Swipe up from the bottom edge of the screen to reveal the sidebar
  document.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 768) return;
    if (getSheetState() !== 'peek') return;
    const startY = e.touches[0].clientY;
    // Only activate when the touch starts within 80px of the bottom
    if (startY < window.innerHeight - 80) return;
    document.addEventListener('touchend', function onEnd(endEvt) {
      document.removeEventListener('touchend', onEnd);
      const dy = endEvt.changedTouches[0].clientY - startY;
      if (dy < -30) snapSheet('mid');
    }, { once: true });
  }, { passive: true });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      autocompleteList.classList.add('hidden');
    }
  });
}

// ===========================
// Tab Switching
// ===========================
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');

  // Refresh browse zoom state whenever the tab is shown
  if (tab === 'browse') updateBrowseZoomState();

  // Mobile: expand to mid if peeking so content is visible
  if (getSheetState() === 'peek') snapSheet('mid');

  // Clear markers when switching tabs
  clearDecorMarkers();
  if (radiusCircle) {
    map.removeLayer(radiusCircle);
    radiusCircle = null;
  }

  // Remove search marker and radius circle when leaving search tab
  if (tab !== 'search') {
    if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
  }

  // Reset search results sidebar when switching away
  if (tab !== 'search') {
    resultsSection.classList.add('hidden');
    emptyState.classList.remove('hidden');
    resultsCount.textContent = '';
    resultsCount.classList.remove('has-tooltip', 'is-loading');
    resultsContent.innerHTML = '';
    decorSummary.innerHTML = '';
    decorSummary.style.display = 'none';
  }

  // Reset active browse categories
  if (tab !== 'browse') {
    activeBrowseCategories.clear();
    browseResultsData = {};
    document.querySelectorAll('.browse-card').forEach(c => c.classList.remove('active'));
    browseResults.classList.add('hidden');
    setBrowseActionsVisible(false);
  }
}

// ===========================
// Mobile Bottom Sheet
// ===========================
let touchStartY = 0;
let sheetDragStartY = 0;

function getSheetState() {
  if (sidebar.classList.contains('mid')) return 'mid';
  return 'peek';
}

function getSheetTargetTop(state) {
  const vh = window.innerHeight;
  if (state === 'mid') return vh * 0.10;
  // Peek: fully off-screen. The #sheet-tab button is the only visible affordance.
  return vh + 10;
}

// Only two states: peek ↔ mid (mid is the ceiling — no full-screen).
function stepUp(_state) { return 'mid'; }
function stepDown(_state) { return 'peek'; }

function applySheetState(state) {
  sidebar.classList.remove('mid');
  if (state === 'mid') sidebar.classList.add('mid');
}

let snapTimeout = null;

// Show the pull-up tab when the sidebar is off-screen, hide it when visible.
// On peek→tab: delay matches the slide-off transition so it appears after the sidebar leaves.
function updateTabVisibility(state) {
  if (!sheetTab || window.innerWidth > 768) return;
  if (state === 'mid') {
    sheetTab.style.display = 'none';
  } else {
    setTimeout(() => { sheetTab.style.display = 'flex'; }, 360);
  }
}

// Snap the sheet to a state, animating smoothly from the current position.
function snapSheet(state) {
  if (window.innerWidth > 768) return;
  if (snapTimeout) { clearTimeout(snapTimeout); snapTimeout = null; }
  updateTabVisibility(state);
  const targetTop = getSheetTargetTop(state);
  // Re-enable transition (may have been suppressed during drag)
  sidebar.style.transition = 'top 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
  // Force layout so the browser registers the current position before we change it
  void sidebar.offsetHeight;
  applySheetState(state);
  sidebar.style.top = `${targetTop}px`;
  // After the animation, let CSS class own the position
  snapTimeout = setTimeout(() => {
    sidebar.style.top = '';
    sidebar.style.transition = '';
    snapTimeout = null;
  }, 400);
}

function getSheetCurrentTop() {
  return sidebar.getBoundingClientRect().top;
}

function handleSheetDragStart(e) {
  if (window.innerWidth > 768) return;
  if (snapTimeout) { clearTimeout(snapTimeout); snapTimeout = null; }
  touchStartY = e.touches[0].clientY;
  sheetDragStartY = getSheetCurrentTop();
  sidebar.style.transition = 'none';
  document.addEventListener('touchmove', handleSheetDragMove, { passive: true });
  document.addEventListener('touchend', handleSheetDragEnd, { once: true });
}

function handleSheetDragMove(e) {
  const dy = e.touches[0].clientY - touchStartY;
  const minTop = getSheetTargetTop('mid');          // can't pull above mid
  const maxTop = getSheetTargetTop('peek') + 60;    // slight over-drag at bottom
  const newTop = Math.max(minTop, Math.min(maxTop, sheetDragStartY + dy));
  sidebar.style.top = `${newTop}px`;
}

function handleSheetDragEnd(e) {
  document.removeEventListener('touchmove', handleSheetDragMove);
  const dy = e.changedTouches[0].clientY - touchStartY;
  // Short tap (barely moved) — treat as a tap to expand
  if (Math.abs(dy) < 8) {
    snapSheet(getSheetState() === 'peek' ? 'mid' : 'peek');
    return;
  }
  const currentTop = getSheetCurrentTop();
  let targetState;
  if (Math.abs(dy) > 50) {
    targetState = dy > 0 ? stepDown(getSheetState()) : stepUp(getSheetState());
  } else {
    const states = ['peek', 'mid'];
    targetState = states.reduce((best, s) =>
      Math.abs(getSheetTargetTop(s) - currentTop) < Math.abs(getSheetTargetTop(best) - currentTop) ? s : best
    );
  }
  snapSheet(targetState);
}

// ===========================
// Autocomplete
// ===========================
function handleAutocompleteInput() {
  const query = addressInput.value.trim();
  if (autocompleteTimer) clearTimeout(autocompleteTimer);

  // Cancel any in-flight request so old responses can't overwrite newer ones
  if (autocompleteController) { autocompleteController.abort(); autocompleteController = null; }

  if (query.length < 3) {
    autocompleteList.classList.add('hidden');
    autocompleteList.innerHTML = '';
    return;
  }

  // Debounce 400ms (Nominatim rate limit)
  autocompleteTimer = setTimeout(async () => {
    autocompleteController = new AbortController();
    const { signal } = autocompleteController;
    try {
      const suggestions = await nominatimAutocomplete(query, signal);
      autocompleteController = null;

      if (suggestions.length === 0) {
        autocompleteList.classList.add('hidden');
        return;
      }

      autocompleteList.innerHTML = suggestions.map(s => `
        <div class="autocomplete-item" data-lat="${s.lat}" data-lon="${s.lon}" data-name="${escapeHtml(s.display_name)}">
          ${escapeHtml(truncateText(s.display_name, 60))}
        </div>
      `).join('');

      autocompleteList.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
          const lat = parseFloat(item.dataset.lat);
          const lon = parseFloat(item.dataset.lon);
          addressInput.value = item.dataset.name;
          autocompleteList.classList.add('hidden');

          zoomToSearchArea(lat, lon);
          placeSearchMarker(lat, lon);
          resultsLocation.textContent = `📍 ${truncateText(item.dataset.name, 35)}`;
          snapSheet('peek');
          fetchDecor(lat, lon);
        });
      });

      autocompleteList.classList.remove('hidden');
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('Autocomplete failed:', e.message);
    }
  }, 400);
}

// ===========================
// Search Handlers
// ===========================
async function handleSearch() {
  if (isLoading) return;
  const address = addressInput.value.trim();
  if (!address) {
    addressInput.focus();
    return;
  }

  showLoading();
  autocompleteList.classList.add('hidden');

  try {
    const data = await nominatimGeocode(address);
    if (!data) throw new Error('Address not found. Try a more specific search.');

    zoomToSearchArea(data.lat, data.lon);
    placeSearchMarker(data.lat, data.lon);
    resultsLocation.textContent = `📍 ${truncateText(data.display_name, 35)}`;
    await fetchDecor(data.lat, data.lon);

    snapSheet('peek');
  } catch (error) {
    showNoResults(error.message);
  } finally {
    hideLoading();
  }
}

function handleMapClick(e) {
  // Collapse any expanded pin before handling the click
  document.querySelectorAll('.decor-marker-pin.expanded').forEach(el => el.classList.remove('expanded'));
  updatePinSelectionState();

  if (isLoading) return;  // don't place a new pin while a query is running
  if (activeTab !== 'search') return;

  const { lat, lng } = e.latlng;
  zoomToSearchArea(lat, lng);
  placeSearchMarker(lat, lng);
  resultsLocation.textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  fetchDecor(lat, lng);

  snapSheet('peek');
}

async function handleLocate() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser');
    return;
  }

  showLoading();
  locateBtn.style.opacity = '0.5';

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      zoomToSearchArea(latitude, longitude);
      placeSearchMarker(latitude, longitude);
      resultsLocation.textContent = '📍 Your Location';
      await fetchDecor(latitude, longitude);
      hideLoading();
      locateBtn.style.opacity = '1';

      snapSheet('peek');
    },
    () => {
      hideLoading();
      locateBtn.style.opacity = '1';
      alert('Could not get your location. Please try searching instead.');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ===========================
// Browse by Decor Type (multi-select)
// ===========================
function loadBrowseGrid() {
  browseGrid.innerHTML = DECOR_MAPPINGS.map(cat => `
    <button class="browse-card" data-category="${escapeHtml(cat.name)}">
      <span class="browse-card-icon"><img src="images/${encodeURIComponent(cat.image)}" alt="${escapeHtml(cat.name)}"></span>
      <span class="browse-card-name">${escapeHtml(cat.name)}</span>
    </button>
  `).join('');

  browseGrid.querySelectorAll('.browse-card').forEach(card => {
    card.addEventListener('click', () => toggleBrowseCategory(card, card.dataset.category));
    card.addEventListener('mouseenter', () => {
      if (browseGrid.classList.contains('too-zoomed-out')) showBrowseTooltip(card);
    });
    card.addEventListener('mouseleave', hideBrowseTooltip);
  });

  updateBrowseZoomState();
}

function toggleBrowseCategory(card, category) {
  if (browseGrid.classList.contains('too-zoomed-out')) {
    showBrowseTooltip(card);
    setTimeout(hideBrowseTooltip, 2500); // auto-dismiss after 2.5s on click
    return;
  }

  if (activeBrowseCategories.has(category)) {
    // Deselect: remove this category
    activeBrowseCategories.delete(category);
    card.classList.remove('active');
    delete browseResultsData[category];
    rebuildBrowseView();
  } else {
    // Select: add this category
    activeBrowseCategories.add(category);
    card.classList.add('active');
    fetchBrowseDecor(category);
  }
  // Show/hide clear + refresh buttons
  setBrowseActionsVisible(activeBrowseCategories.size > 0);
}

function setBrowseActionsVisible(visible) {
  browseClearBtn.classList.toggle('hidden', !visible);
  browseRefreshBtn.classList.toggle('hidden', !visible);
  if (mapBrowseActionsEl) mapBrowseActionsEl.classList.toggle('hidden', !visible);
}

function clearBrowseAll() {
  activeBrowseCategories.clear();
  browseResultsData = {};
  document.querySelectorAll('.browse-card').forEach(c => c.classList.remove('active'));
  clearDecorMarkers();
  browseResults.classList.add('hidden');
  setBrowseActionsVisible(false);
  browseResultsCount.classList.remove('has-tooltip');
  browseResultsCount._summaryData = null;
  browseResultsCount.onclick = null;
  document.getElementById('count-tooltip')?.remove();
}

async function fetchBrowseDecor(category) {
  showLoading();

  try {
    const bounds = map.getBounds();
    const south = bounds.getSouth(), west = bounds.getWest();
    const north = bounds.getNorth(), east = bounds.getEast();

    const query = buildOverpassBboxQuery(south, west, north, east, category);
    if (!query) throw new Error('Unknown decor category: ' + category);

    const elements = await queryOverpass(query, 30000);
    const decor = DECOR_MAPPINGS.find(d => d.name === category);
    const bboxCLat = (south + north) / 2;
    const bboxCLon = (west + east) / 2;

    const results = elements
      .filter(el => el.tags)
      .map(el => {
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        if (!elLat || !elLon) return null;
        const inBbox = elLat >= south && elLat <= north && elLon >= west && elLon <= east;
        const displayLat = (el.type === 'relation' && !inBbox) ? bboxCLat : elLat;
        const displayLon = (el.type === 'relation' && !inBbox) ? bboxCLon : elLon;
        return {
          id: el.id, category: decor.name, icon: decor.icon, image: decor.image,
          mapIcon: decor.mapIcon, color: decor.color,
          name: el.tags.name || decor.name, lat: displayLat, lon: displayLon
        };
      })
      .filter(Boolean);

    browseResultsData[category] = results;
    rebuildBrowseView();
  } catch (error) {
    if (error.isTimeout) {
      showTimeoutError(() => fetchBrowseDecor(category));
    } else {
      // On non-timeout error, deselect the category and show inline error
      activeBrowseCategories.delete(category);
      document.querySelector(`.browse-card[data-category="${CSS.escape(category)}"]`)?.classList.remove('active');
      delete browseResultsData[category];
      setBrowseActionsVisible(activeBrowseCategories.size > 0);

      browseResultsLabel.textContent = category;
      browseResultsCount.textContent = '';
      browseResultsContent.innerHTML = `
        <div class="no-results">
          <div class="no-results-icon">⚠️</div>
          <p>${escapeHtml(error.message)}</p>
          <button class="retry-btn" onclick="retryBrowseCategory('${escapeHtml(category)}')">Try Again</button>
        </div>
      `;
      browseResults.classList.remove('hidden');
    }
  } finally {
    hideLoading();
  }
}

function retryBrowseCategory(category) {
  const card = document.querySelector(`.browse-card[data-category="${CSS.escape(category)}"]`);
  if (card) {
    activeBrowseCategories.add(category);
    card.classList.add('active');
    setBrowseActionsVisible(true);
  }
  fetchBrowseDecor(category);
}

async function refreshBrowseViewport() {
  const decorNames = Array.from(activeBrowseCategories);
  if (decorNames.length === 0) return;

  showLoading();

  try {
    const bounds = map.getBounds();
    const south = bounds.getSouth(), west = bounds.getWest();
    const north = bounds.getNorth(), east = bounds.getEast();

    const query = buildOverpassBboxQueryMulti(south, west, north, east, decorNames);
    if (!query) return;

    const elements = await queryOverpass(query, 30000);

    const decorByName = {};
    DECOR_MAPPINGS.filter(d => decorNames.includes(d.name)).forEach(d => { decorByName[d.name] = d; });

    const byCategory = {};
    decorNames.forEach(name => { byCategory[name] = []; });

    const seen = new Set();
    const bboxCLat = (south + north) / 2;
    const bboxCLon = (west + east) / 2;

    elements.filter(el => el.tags).forEach(el => {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (!elLat || !elLon) return;

      const inBbox = elLat >= south && elLat <= north && elLon >= west && elLon <= east;
      const displayLat = (el.type === 'relation' && !inBbox) ? bboxCLat : elLat;
      const displayLon = (el.type === 'relation' && !inBbox) ? bboxCLon : elLon;

      matchDecorCategories(el.tags)
        .filter(decor => decorByName[decor.name])
        .forEach(decor => {
          const key = `${decor.name}-${el.id}`;
          if (seen.has(key)) return;
          seen.add(key);
          byCategory[decor.name].push({
            id: el.id, category: decor.name, icon: decor.icon, image: decor.image,
            mapIcon: decor.mapIcon, color: decor.color,
            name: el.tags.name || decor.name, lat: displayLat, lon: displayLon
          });
        });
    });

    for (const [name, results] of Object.entries(byCategory)) {
      browseResultsData[name] = results;
    }
    rebuildBrowseView();
  } catch (error) {
    if (error.isTimeout) {
      showTimeoutError(() => refreshBrowseViewport());
    } else {
      console.error('Viewport refresh failed:', error.message);
    }
  } finally {
    hideLoading();
  }
}

function rebuildBrowseView() {
  // Combine all results from all active categories
  const allResults = [];
  for (const [cat, results] of Object.entries(browseResultsData)) {
    results.forEach(r => allResults.push(r));
  }

  // Rebuild markers on map
  clearDecorMarkers();
  if (allResults.length > 0) {
    addDecorMarkers(allResults);
  }

  if (activeBrowseCategories.size === 0) {
    browseResults.classList.add('hidden');
    return;
  }

  const activeNames = Array.from(activeBrowseCategories);
  browseResultsLabel.textContent = activeNames.length === 1
    ? activeNames[0]
    : `${activeNames.length} categories`;

  // Deduplicate: one entry per OSM element
  const groups = groupResultsByLocation(allResults);

  browseResultsCount.textContent = `${groups.length} found`;

  if (groups.length > 0) {
    const summaryMap = {};
    groups.forEach(g => {
      g.decors.forEach(d => {
        if (!summaryMap[d.category]) summaryMap[d.category] = { name: d.category, image: d.image, count: 0 };
        summaryMap[d.category].count++;
      });
    });
    browseResultsCount.classList.add('has-tooltip');
    browseResultsCount._summaryData = Object.values(summaryMap);
    browseResultsCount.onclick = null;
    browseResultsCount.onclick = (e) => { e.stopPropagation(); toggleBrowseCountTooltip(); };
  } else {
    browseResultsCount.classList.remove('has-tooltip');
    browseResultsCount._summaryData = null;
    browseResultsCount.onclick = null;
  }

  if (groups.length === 0) {
    browseResultsContent.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🍃</div>
        <p>No locations found in this area.</p>
      </div>
    `;
  } else {
    let listHtml = '<div class="decor-list">';
    groups.slice(0, 100).forEach(g => {
      const multiClass = g.decors.length > 1 ? ' decor-icon-multi' : '';
      const iconImgs = g.decors.map(d =>
        `<img src="images/${encodeURIComponent(d.image)}" alt="${escapeHtml(d.category)}">`
      ).join('');
      const categoryText = g.decors.map(d => d.category).join(' · ');
      listHtml += `
        <div class="decor-item" onclick="panToLocation(${g.lat}, ${g.lon})">
          <div class="decor-icon${multiClass}">${iconImgs}</div>
          <div class="decor-info">
            <div class="decor-name">${escapeHtml(g.name)}</div>
            <div class="decor-category">${escapeHtml(categoryText)}</div>
          </div>
        </div>
      `;
    });
    listHtml += '</div>';

    if (groups.length > 100) {
      listHtml += `<p style="text-align: center; color: var(--text-secondary); padding: 16px; font-size: 13px;">
        Showing first 100 of ${groups.length} results
      </p>`;
    }

    browseResultsContent.innerHTML = listHtml;
  }

  browseResults.classList.remove('hidden');
}

// ===========================
// Decor Fetching (Search tab)
// ===========================
async function fetchDecor(lat, lon) {
  showSearchLoading();
  lastSearchLat = lat;
  lastSearchLon = lon;

  try {
    const query = buildOverpassQuery(lat, lon, SEARCH_RADIUS);
    const elements = await queryOverpass(query, 45000);

    const decorResults = [];
    const seen = new Set();

    elements.forEach(element => {
      if (!element.tags) return;
      const decors = matchDecorCategories(element.tags);
      if (decors.length === 0) return;

      const elLat = element.lat ?? element.center?.lat;
      const elLon = element.lon ?? element.center?.lon;
      if (!elLat || !elLon) return;

      // Snap large-area relation centroids to the search point
      const centerDist = calculateDistance(lat, lon, elLat, elLon);
      const displayLat = (element.type === 'relation' && centerDist > SEARCH_RADIUS) ? lat : elLat;
      const displayLon = (element.type === 'relation' && centerDist > SEARCH_RADIUS) ? lon : elLon;
      const name = element.tags.name || decors[0].name;

      decors.forEach(decor => {
        const key = `${decor.name}-${element.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        decorResults.push({
          id: element.id,
          category: decor.name, icon: decor.icon, image: decor.image,
          mapIcon: decor.mapIcon, color: decor.color, name,
          lat: displayLat, lon: displayLon,
          distance: calculateDistance(lat, lon, displayLat, displayLon)
        });
      });
    });

    decorResults.sort((a, b) => a.distance - b.distance);

    updateRadiusCircle(lat, lon);
    clearDecorMarkers();

    if (decorResults.length === 0) {
      showNoResults('No decor found in this area. Try a different location!');
    } else {
      displayResults({ results: decorResults, total: decorResults.length });
      addDecorMarkers(decorResults);
    }
  } catch (error) {
    if (error.isTimeout) {
      showTimeoutError(() => fetchDecor(lat, lon));
    } else {
      showError(error.message || 'Failed to fetch decor.', () => fetchDecor(lat, lon));
    }
  } finally {
    hideLoading();
  }
}

// ===========================
// Results Display
// ===========================
function displayResults(data) {
  emptyState.classList.add('hidden');
  resultsSection.classList.remove('hidden');

  // Deduplicate: one entry per OSM element (double-decor = one list row)
  const groups = groupResultsByLocation(data.results);

  resultsCount.textContent = `${groups.length} found`;
  resultsCount.classList.add('has-tooltip');
  resultsCount.classList.remove('is-loading');

  // Build summary client-side (includes image field for the tooltip)
  const summaryMap = {};
  groups.forEach(g => {
    g.decors.forEach(d => {
      if (!summaryMap[d.category]) summaryMap[d.category] = { name: d.category, image: d.image, count: 0 };
      summaryMap[d.category].count++;
    });
  });
  resultsCount._summaryData = Object.values(summaryMap);
  resultsCount.onclick = null;
  resultsCount.onclick = (e) => { e.stopPropagation(); toggleCountTooltip(); };

  decorSummary.innerHTML = '';
  decorSummary.style.display = 'none';

  let listHtml = '<div class="decor-list">';
  groups.slice(0, 50).forEach(g => {
    const multiClass = g.decors.length > 1 ? ' decor-icon-multi' : '';
    const iconImgs = g.decors.map(d =>
      `<img src="images/${encodeURIComponent(d.image)}" alt="${escapeHtml(d.category)}">`
    ).join('');
    const categoryText = g.decors.map(d => d.category).join(' · ');
    listHtml += `
      <div class="decor-item" data-lat="${g.lat}" data-lon="${g.lon}" onclick="panToLocation(${g.lat}, ${g.lon})">
        <div class="decor-icon${multiClass}">${iconImgs}</div>
        <div class="decor-info">
          <div class="decor-name">${escapeHtml(g.name)}</div>
          <div class="decor-category">${escapeHtml(categoryText)}</div>
        </div>
        <div class="decor-distance">${formatDistance(g.distance)}</div>
      </div>
    `;
  });
  listHtml += '</div>';

  if (groups.length > 50) {
    listHtml += `<p style="text-align: center; color: var(--text-secondary); padding: 16px; font-size: 13px;">
      Showing first 50 of ${groups.length} results
    </p>`;
  }

  resultsContent.innerHTML = listHtml;
}

function toggleCountTooltip() {
  const existing = document.getElementById('count-tooltip');
  if (existing) {
    existing.remove();
    return;
  }

  const summaryData = resultsCount._summaryData;
  if (!summaryData || summaryData.length === 0) return;

  const tooltip = document.createElement('div');
  tooltip.id = 'count-tooltip';
  tooltip.className = 'count-tooltip';

  // Build decor images with hover tooltips for the category breakdown popup
  summaryData.forEach(cat => {
    const span = document.createElement('span');
    span.className = 'count-tooltip-icon';

    const img = document.createElement('img');
    img.src = `images/${encodeURIComponent(cat.image)}`;
    img.alt = cat.name;
    img.style.cssText = 'width:24px;height:24px;object-fit:contain;display:block;';
    span.appendChild(img);

    const label = document.createElement('span');
    label.className = 'emoji-label';
    label.textContent = cat.name;
    span.appendChild(label);

    tooltip.appendChild(span);
  });

  resultsCount.parentElement.style.position = 'relative';
  resultsCount.parentElement.appendChild(tooltip);

  // Auto-dismiss on outside click
  setTimeout(() => {
    const dismiss = (e) => {
      if (!e.target.closest('.count-tooltip') && !e.target.closest('.results-count')) {
        tooltip.remove();
        document.removeEventListener('click', dismiss);
      }
    };
    document.addEventListener('click', dismiss);
  }, 10);
}

function toggleBrowseCountTooltip() {
  const existing = document.getElementById('count-tooltip');
  if (existing) { existing.remove(); return; }

  const summaryData = browseResultsCount._summaryData;
  if (!summaryData || summaryData.length === 0) return;

  const tooltip = document.createElement('div');
  tooltip.id = 'count-tooltip';
  tooltip.className = 'count-tooltip';

  summaryData.forEach(cat => {
    const span = document.createElement('span');
    span.className = 'count-tooltip-icon';

    const img = document.createElement('img');
    img.src = `images/${encodeURIComponent(cat.image)}`;
    img.alt = cat.name;
    img.style.cssText = 'width:24px;height:24px;object-fit:contain;display:block;';
    span.appendChild(img);

    const label = document.createElement('span');
    label.className = 'emoji-label';
    label.textContent = cat.name;
    span.appendChild(label);

    tooltip.appendChild(span);
  });

  browseResultsCount.parentElement.style.position = 'relative';
  browseResultsCount.parentElement.appendChild(tooltip);

  setTimeout(() => {
    const dismiss = (e) => {
      if (!e.target.closest('.count-tooltip') && !e.target.closest('.results-count')) {
        tooltip.remove();
        document.removeEventListener('click', dismiss);
      }
    };
    document.addEventListener('click', dismiss);
  }, 10);
}

function showNoResults(message) {
  emptyState.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  resultsCount.textContent = '';
  resultsCount.removeAttribute('title');
  resultsCount.classList.remove('has-tooltip');
  decorSummary.innerHTML = '';
  decorSummary.style.display = 'none';
  resultsContent.innerHTML = `
    <div class="no-results">
      <div class="no-results-icon">🍃</div>
      <p>${message}</p>
    </div>
  `;
}

function showError(message, retryFn) {
  emptyState.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  resultsCount.textContent = '';
  resultsCount.removeAttribute('title');
  resultsCount.classList.remove('has-tooltip');
  decorSummary.innerHTML = '';
  decorSummary.style.display = 'none';
  resultsContent.innerHTML = `
    <div class="no-results">
      <div class="no-results-icon">⚠️</div>
      <p>${escapeHtml(message)}</p>
      <button class="retry-btn" id="retry-btn">Try Again</button>
    </div>
  `;
  document.getElementById('retry-btn').addEventListener('click', () => {
    retryFn();
  });
}

// ===========================
// Markers — grouped by location, pin style
// ===========================
function placeSearchMarker(lat, lon) {
  if (searchMarker) map.removeLayer(searchMarker);

  const icon = L.divIcon({
    className: 'search-marker',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  searchMarker = L.marker([lat, lon], { icon }).addTo(map);
}

function addDecorMarkers(results) {
  // Group results by location (same lat/lon = same pin)
  const groups = {};
  results.forEach(item => {
    const key = `${item.lat.toFixed(6)}_${item.lon.toFixed(6)}`;
    if (!groups[key]) {
      groups[key] = { lat: item.lat, lon: item.lon, items: [] };
    }
    groups[key].items.push(item);
  });

  Object.values(groups).forEach(group => {
    // Specific categories first so the pin shows the most relevant icon
    group.items.sort((a, b) => {
      const aG = DECOR_CATEGORY_PRIORITY[a.category] ?? 0;
      const bG = DECOR_CATEGORY_PRIORITY[b.category] ?? 0;
      return aG - bG;
    });
    const firstItem = group.items[0];

    // Collect unique pikmin sprites for the expanded panel (sidebar-style images)
    const seenImages = new Set();
    const pikminImgs = [];
    group.items.forEach(i => {
      if (!seenImages.has(i.image)) {
        seenImages.add(i.image);
        pikminImgs.push(`<img class="marker-pikmin-img" src="images/${encodeURIComponent(i.image)}" alt="${escapeHtml(i.category)}">`);
      }
    });

    // Build expandable detail rows (one per unique location name)
    const locationMap = {};
    group.items.forEach(item => {
      if (!locationMap[item.name]) {
        locationMap[item.name] = { name: item.name, categories: [], distance: item.distance };
      }
      locationMap[item.name].categories.push(item.category);
    });

    const detailRows = Object.values(locationMap).map(loc => `
      <div class="marker-detail-row">
        <div class="marker-detail-name">${escapeHtml(loc.name)}</div>
        <div class="marker-detail-cats">${loc.categories.join(', ')}${loc.distance !== undefined ? ' · ' + formatDistance(loc.distance) : ''}</div>
      </div>
    `).join('');

    const icon = L.divIcon({
      className: 'decor-marker-wrapper',
      // .decor-marker-anchor uses CSS translate(-50%, -100%) so the arrow tip
      // sits exactly on the lat/lon coordinate rather than the top-left corner.
      html: `<div class="decor-marker-anchor">
        <div class="decor-marker-pin">
          <div class="decor-marker-pill">
            <img class="map-icon-img" src="images/mapicons/${encodeURIComponent(firstItem.mapIcon)}" alt="${escapeHtml(firstItem.category)}">
            <div class="marker-details">
              <div class="marker-details-inner">
                <div class="marker-pikmin-row">${pikminImgs.join('')}</div>
                ${detailRows}
              </div>
            </div>
          </div>
          <div class="decor-marker-arrow"></div>
        </div>
      </div>`,
      iconSize: [0, 0],   // zero-size container; anchor div handles positioning
      iconAnchor: [0, 0]
    });

    const marker = L.marker([group.lat, group.lon], { icon }).addTo(map);

    // Index marker by location for programmatic selection from the sidebar list
    const markerKey = `${group.lat.toFixed(6)}_${group.lon.toFixed(6)}`;
    decorMarkersMap[markerKey] = marker;

    // Click toggles expanded detail panel; stops propagation so the map
    // click handler doesn't immediately collapse the pin we just opened.
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      const pinEl = marker.getElement()?.querySelector('.decor-marker-pin');
      if (!pinEl) return;
      const wasExpanded = pinEl.classList.contains('expanded');
      document.querySelectorAll('.decor-marker-pin.expanded').forEach(el => el.classList.remove('expanded'));
      if (!wasExpanded) pinEl.classList.add('expanded');
      updatePinSelectionState();
    });

    // Bring marker to front on hover so overlapping pins don't obscure it
    marker.on('mouseover', () => marker.setZIndexOffset(1000));
    marker.on('mouseout', () => marker.setZIndexOffset(0));

    decorMarkers.push(marker);
  });
}

function clearDecorMarkers() {
  decorMarkers.forEach(marker => map.removeLayer(marker));
  decorMarkers = [];
  decorMarkersMap = {};
  updatePinSelectionState();
}

// Toggles the "pins-have-selection" class on the map container so CSS can
// dim non-expanded pins when one is selected.
function updatePinSelectionState() {
  const hasExpanded = document.querySelectorAll('.decor-marker-pin.expanded').length > 0;
  map.getContainer().classList.toggle('pins-have-selection', hasExpanded);
}

// The browse grid is disabled below zoom 13 — the bbox would be too large
// to query meaningfully. Toggle a class so CSS can gray out the cards.
const BROWSE_MIN_ZOOM = 14;

function updateBrowseZoomState() {
  const tooZoomedOut = map.getZoom() < BROWSE_MIN_ZOOM;
  browseGrid.classList.toggle('too-zoomed-out', tooZoomedOut);
}

// Floating tooltip shown when hovering a grayed-out browse card
let _browseTooltipEl = null;

function showBrowseTooltip(anchor) {
  hideBrowseTooltip();
  const tt = document.createElement('div');
  tt.className = 'browse-zoom-tooltip';
  tt.textContent = 'Zoom in — the area is too broad right now.';
  document.body.appendChild(tt);

  const rect = anchor.getBoundingClientRect();
  tt.style.left = `${rect.left + rect.width / 2}px`;
  tt.style.top  = `${rect.top - 8}px`;
  _browseTooltipEl = tt;
}

function hideBrowseTooltip() {
  if (_browseTooltipEl) { _browseTooltipEl.remove(); _browseTooltipEl = null; }
}

function updateRadiusCircle(lat, lon) {
  if (radiusCircle) map.removeLayer(radiusCircle);

  radiusCircle = L.circle([lat, lon], {
    radius: SEARCH_RADIUS,
    color: '#FF6B9D',
    fillColor: '#FF6B9D',
    fillOpacity: 0.08,
    weight: 2,
    dashArray: '6, 8'
  }).addTo(map);
}

// ===========================
// Utilities
// ===========================
/**
 * Fit the map view so the search-radius circle is comfortably visible.
 * Uses fitBounds on the circle's bounding box with generous padding so
 * the circle never touches the edges. maxZoom prevents over-zooming on
 * very small radii.
 */
function zoomToSearchArea(lat, lon) {
  const latDelta = SEARCH_RADIUS / 111320;
  const lonDelta = SEARCH_RADIUS / (111320 * Math.cos(lat * Math.PI / 180));
  map.fitBounds(
    [[lat - latDelta, lon - lonDelta], [lat + latDelta, lon + lonDelta]],
    { padding: [80, 80], maxZoom: 17, animate: true }
  );
}

function panToLocation(lat, lon) {
  map.setView([lat, lon], 18);

  // Find the marker at this location, expand it, and dim everything else
  const key = `${parseFloat(lat).toFixed(6)}_${parseFloat(lon).toFixed(6)}`;
  const marker = decorMarkersMap[key];
  if (!marker) return;

  // Leaflet may need a tick to finish repositioning after setView
  setTimeout(() => {
    const pinEl = marker.getElement()?.querySelector('.decor-marker-pin');
    if (!pinEl) return;
    document.querySelectorAll('.decor-marker-pin.expanded').forEach(el => el.classList.remove('expanded'));
    pinEl.classList.add('expanded');
    updatePinSelectionState();
  }, 50);
}

function showLoading() {
  isLoading = true;
  loading.classList.remove('hidden');
  // Freeze map interactions
  map.dragging.disable();
  map.scrollWheelZoom.disable();
  map.doubleClickZoom.disable();
  map.touchZoom.disable();
  // Disable search controls so the user can't fire a new query mid-flight
  addressInput.disabled = true;
  searchBtn.disabled = true;
  locateBtn.disabled = true;
}

function hideLoading() {
  // When a timeout modal is showing, the finally{} block calls hideLoading() but
  // we don't want to close the modal — just clear the suppress flag and bail out.
  if (_suppressHideLoading) { _suppressHideLoading = false; return; }
  isLoading = false;
  loading.classList.add('hidden');
  // Reset timeout modal state for next time
  loadingNormal.style.display = '';
  loadingTimeout.style.display = 'none';
  // Restore map interactions
  map.dragging.enable();
  map.scrollWheelZoom.enable();
  map.doubleClickZoom.enable();
  map.touchZoom.enable();
  // Re-enable search controls
  addressInput.disabled = false;
  searchBtn.disabled = false;
  locateBtn.disabled = false;
}

function showTimeoutError(retryFn) {
  _suppressHideLoading = true;  // block the coming finally{hideLoading()} call
  pendingRetryFn = retryFn;
  loadingNormal.style.display = 'none';
  loadingTimeout.style.display = 'flex';
  // loading overlay stays visible — user sees the error state
}

function formatDistance(meters) {
  if (meters === undefined) return '';
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// Groups flat results (one entry per category match) into per-location groups
// keyed by OSM element ID. Within each group, specific categories sort before
// generic ones (Restaurant / Café) so the right icon appears on the map pin.
function groupResultsByLocation(results) {
  const groups = new Map();
  results.forEach(item => {
    if (!groups.has(item.id)) {
      groups.set(item.id, {
        id: item.id, lat: item.lat, lon: item.lon,
        name: item.name, distance: item.distance, decors: []
      });
    }
    const g = groups.get(item.id);
    if (!g.decors.some(d => d.category === item.category)) {
      g.decors.push({ category: item.category, image: item.image, mapIcon: item.mapIcon });
    }
  });
  groups.forEach(g => {
    g.decors.sort((a, b) => {
      const aG = DECOR_CATEGORY_PRIORITY[a.category] ?? 0;
      const bG = DECOR_CATEGORY_PRIORITY[b.category] ?? 0;
      return aG - bG;
    });
  });
  return Array.from(groups.values());
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.panToLocation = panToLocation;
window.fetchBrowseDecor = fetchBrowseDecor;
window.retryBrowseCategory = retryBrowseCategory;
window.refreshBrowseViewport = refreshBrowseViewport;

// Show search loading: clear old results, show grayed badge
function showSearchLoading() {
  showLoading();
  emptyState.classList.add('hidden');
  resultsSection.classList.remove('hidden');

  // Grayed-out loading badge
  resultsCount.textContent = 'Loading...';
  resultsCount.classList.add('is-loading');
  resultsCount.classList.remove('has-tooltip');
  resultsCount._summaryData = null;

  // Clear old list
  resultsContent.innerHTML = '';
  decorSummary.innerHTML = '';
  decorSummary.style.display = 'none';

  // Dismiss old tooltip
  const oldTooltip = document.getElementById('count-tooltip');
  if (oldTooltip) oldTooltip.remove();

  // Clear old markers while we wait
  clearDecorMarkers();
}
