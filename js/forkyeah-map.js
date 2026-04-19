import { LitElement, html, css } from 'https://cdn.jsdelivr.net/gh/lit/dist@2/all/lit-all.min.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const NYC_BOUNDS  = [[40.4774, -74.2591], [40.9176, -73.7004]];
const NYC_CENTER  = [40.7128, -74.0060];
const MIN_ZOOM    = 13;
const DEBOUNCE_MS = 300;
const API_BASE    = 'https://data.cityofnewyork.us/resource/43nn-pn8j.json';

const API_SELECT  = 'camis,latitude,longitude,dba,building,street,cuisine_description,boro';

const SHADOW_CSS_HREFS = [
  'https://unpkg.com/leaflet/dist/leaflet.css',
];

// ─── Cuisine filter mapping (filter label → SoQL LIKE value) ─────────────────
const CUISINE_MAP = {
  'American':  'American',
  'Chinese':   'Chinese',
  'Italian':   'Italian',
  'Japanese':  'Japanese',
  'Mexican':   'Mexican',
  'Indian':    'Indian',
  'Thai':      'Thai',
};

// ─── Borough filter mapping (filter label → API boro string) ─────────────────
// The NYC DOH dataset stores boro as mixed-case strings.
const BOROUGH_MAP = {
  'Manhattan':   'Manhattan',
  'Brooklyn':    'Brooklyn',
  'Queens':      'Queens',
  'The Bronx':   'Bronx',
  'Staten Island': 'Staten Island',
};

// ─── Red pin icon (SVG) ───────────────────────────────────────────────────────
const RED_PIN_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36">
    <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24S24 21 24 12C24 5.373 18.627 0 12 0z"
          fill="#ff0019" stroke="#aa0010" stroke-width="0.8"/>
    <circle cx="12" cy="12" r="5" fill="#fff" opacity="0.9"/>
  </svg>
`;

// ─── Component ────────────────────────────────────────────────────────────────
export class ForkYeahMap extends LitElement {
  static get tag() { return 'forkyeah-map'; }

  static get styles() {
    return css`
      :host {
        display: block;
        width:  var(--map-width,  100%);
        height: var(--map-height, 400px);
      }

      #map {
        width: 100%;
        height: 100%;
      }

      /* Custom red pin — override Leaflet default icon wrapper */
      .fy-red-pin {
        background: none !important;
        border: none !important;
      }
    `;
  }

  constructor() {
    super();
    this._map           = null;
    this._markerLayer   = null;
    this._loadedIds     = new Set();
    this._fetchedBounds = [];
    this._debounceTimer = null;
    this._abortCtrl     = null;

    // Active filters (populated by forkyeah-navbar via document event)
    this._filters = {
      COUNTRY: 'All Countries',
      BOROUGH: 'All Boroughs',
      PRICE:   'Any Price',
    };

    // Listen for filter changes from any navbar instance
    this._onFilter = (e) => {
      this._filters = e.detail;
      this._resetAndReload();
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  firstUpdated() {
    this._injectShadowCSS().then(() => this._initMap());
    document.addEventListener('forkyeah-filter', this._onFilter);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._debounceTimer);
    this._abortCtrl?.abort();
    this._map?.remove();
    document.removeEventListener('forkyeah-filter', this._onFilter);
  }

  // ─── Asset Loading ──────────────────────────────────────────────────────────

  _injectShadowCSS() {
    const promises = SHADOW_CSS_HREFS.map(href => {
      if (this.renderRoot.querySelector(`link[href="${href}"]`)) return Promise.resolve();
      return new Promise(resolve => {
        const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
        link.addEventListener('load',  resolve, { once: true });
        link.addEventListener('error', resolve, { once: true });
        this.renderRoot.appendChild(link);
      });
    });
    return Promise.all(promises);
  }

  // ─── Map Initialisation ─────────────────────────────────────────────────────

  _initMap() {
    this._map = L.map(this.renderRoot.querySelector('#map'), {
      maxBounds: NYC_BOUNDS,
      maxBoundsViscosity: 1.0,
      minZoom: 11,
      maxZoom: 18,
    }).setView(NYC_CENTER, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      updateWhenIdle: true,
      keepBuffer: 2,
    }).addTo(this._map);

    this._markerLayer = L.layerGroup().addTo(this._map);

    requestAnimationFrame(() => this._map.invalidateSize());

    this._loadRestaurantsInView();

    this._map.on('moveend', () => {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => this._loadRestaurantsInView(), DEBOUNCE_MS);
    });
  }

  // ─── Filter Helpers ──────────────────────────────────────────────────────────

  /** Build additional SoQL WHERE clauses from active filters */
  _filterClauses() {
    const clauses = [];

    const country = this._filters.COUNTRY;
    if (country && CUISINE_MAP[country]) {
      // Case-insensitive contains search
      clauses.push(`upper(cuisine_description) like '%${CUISINE_MAP[country].toUpperCase()}%'`);
    }

    const borough = this._filters.BOROUGH;
    if (borough && BOROUGH_MAP[borough]) {
      clauses.push(`upper(boro)='${BOROUGH_MAP[borough].toUpperCase()}'`);
    }

    // Price is not available in the NYC DOH inspection API — ignored.

    return clauses;
  }

  /** Clear all markers and fetch state, then reload from scratch */
  _resetAndReload() {
    this._markerLayer?.clearLayers();
    this._loadedIds.clear();
    this._fetchedBounds = [];
    this._abortCtrl?.abort();
    if (this._map) this._loadRestaurantsInView();
  }

  // ─── Data Fetching ──────────────────────────────────────────────────────────

  _alreadyFetched(bounds) {
    return this._fetchedBounds.some(b => b.contains(bounds));
  }

  async _loadRestaurantsInView() {
    const zoom = this._map.getZoom();

    if (zoom < MIN_ZOOM) {
      this._markerLayer.clearLayers();
      this._loadedIds.clear();
      this._fetchedBounds = [];
      return;
    }

    const bounds = this._map.getBounds();
    if (this._alreadyFetched(bounds)) return;

    this._abortCtrl?.abort();
    this._abortCtrl = new AbortController();

    // Build WHERE clause: bounding box + active filters
    const bboxClause = `latitude>${bounds.getSouth()} AND latitude<${bounds.getNorth()} AND longitude>${bounds.getWest()} AND longitude<${bounds.getEast()}`;
    const extraClauses = this._filterClauses();
    const whereClause = [bboxClause, ...extraClauses].join(' AND ');

    const url = new URL(API_BASE);
    url.searchParams.set('$select', API_SELECT);
    url.searchParams.set('$where',  whereClause);
    url.searchParams.set('$limit',  '300');

    try {
      const res  = await fetch(url, { signal: this._abortCtrl.signal });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();

      this._fetchedBounds.push(bounds);
      this._addNewMarkers(data);
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Failed to load restaurants:', err);
    }
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  /** Shared red pin Leaflet icon */
  _redIcon() {
    return L.divIcon({
      className: 'fy-red-pin',
      html: RED_PIN_SVG,
      iconSize:    [24, 36],
      iconAnchor:  [12, 36],
      popupAnchor: [0, -38],
    });
  }

  _addNewMarkers(data) {
    const icon = this._redIcon();

    data.forEach(r => {
      if (!r.latitude || !r.longitude || !r.camis) return;
      if (this._loadedIds.has(r.camis)) return;

      const address = [r.building, r.street].filter(Boolean).join(' ');

      L.marker([parseFloat(r.latitude), parseFloat(r.longitude)], { icon })
        .bindPopup(
          `<b>${r.dba ?? 'Unknown'}</b><br>${address}<br>🍽️ ${r.cuisine_description ?? 'Various'}`,
          { maxWidth: 220 }
        )
        .addTo(this._markerLayer);

      this._loadedIds.add(r.camis);
    });
  }

  render() {
    return html`<div id="map"></div>`;
  }
}

customElements.define(ForkYeahMap.tag, ForkYeahMap);