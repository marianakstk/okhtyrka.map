/**
 * How to run locally (recommended):
 *   - python3 -m http.server 8080
 *   - Then open http://localhost:8080
 * Why: Fetching pins.json via file:// will run into CORS issues.
 *
 * How to deploy:
 *   - Push this repo to GitHub and enable GitHub Pages (root). Or deploy to Netlify as a static site.
 *
 * Scaling note:
 *   - If you add hundreds of pins later, include Leaflet.markercluster. This script will detect the plugin and use it automatically.
 */
(() => {
  'use strict';

  // ----------------------------
  // Config
  // ----------------------------
  const OKHTYRKA_FALLBACK = { lat: 50.31, lng: 34.90, zoom: 12 };

  const CARTO_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
    '&copy; <a href="https://carto.com/attributions">CARTO</a>';

  const TILES = {
    light: L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 20, attribution: CARTO_ATTR }
    ),
    dark: L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 20, attribution: CARTO_ATTR }
    ),
  };
  const STORAGE_KEY_THEME = 'okhtyrka-map-theme';

  // ----------------------------
  // DOM
  // ----------------------------
  const els = {
    map: document.getElementById('map'),
    panel: document.getElementById('panel'),
    overlay: document.getElementById('overlay'),
    panelTitle: document.getElementById('panelTitle'),
    panelMeta: document.getElementById('panelMeta'),
    captionText: document.getElementById('captionText'),
    copyLinkBtn: document.getElementById('copyLinkBtn'),
    closePanelBtn: document.getElementById('closePanelBtn'),
    themeToggle: document.getElementById('themeToggle'),
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    prevImgBtn: document.getElementById('prevImgBtn'),
    nextImgBtn: document.getElementById('nextImgBtn'),
    galleryViewport: document.getElementById('galleryViewport'),
    galleryImg: document.getElementById('galleryImg'),
    galleryCounter: document.getElementById('galleryCounter'),
  };

  // ----------------------------
  // State
  // ----------------------------
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pins = [];
  const pinIndex = new Map();
  let map;
  let currentTheme = 'light';
  let currentPinId = null;
  let lastFocusedEl = null;
  let galleryImages = [];
  let galleryIndex = 0;
  let swipeX0 = 0;
  let swipeX1 = 0;
  let swiping = false;
  let markerContainer;

  // ----------------------------
  // Helpers
  // ----------------------------
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }
  function isValidCoords(coords) {
    return Array.isArray(coords) && coords.length === 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1]);
  }
  function formatDate(iso) {
    if (!iso || typeof iso !== 'string') return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' }).format(d);
  }
  function getHashPinId() {
    const h = window.location.hash || '';
    if (!h.startsWith('#pin=')) return null;
    const id = decodeURIComponent(h.slice('#pin='.length));
    return id || null;
  }
  function setHashPinId(id) {
    const next = `#pin=${encodeURIComponent(id)}`;
    if (window.location.hash === next) return;
    window.location.hash = next;
  }
  function clearHash() {
    const url = `${window.location.pathname}${window.location.search}`;
    history.replaceState(null, '', url);
  }
  function setTheme(theme) {
    currentTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    els.themeToggle.setAttribute('aria-pressed', String(currentTheme === 'dark'));
    if (!map) return;
    TILES.light.remove();
    TILES.dark.remove();
    (currentTheme === 'dark' ? TILES.dark : TILES.light).addTo(map);
    localStorage.setItem(STORAGE_KEY_THEME, currentTheme);
  }
  function loadInitialTheme() {
    const saved = localStorage.getItem(STORAGE_KEY_THEME);
    if (saved === 'light' || saved === 'dark') return saved;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }
  function openPanel() {
    els.panel.classList.add('is-open');
    els.panel.setAttribute('aria-hidden', 'false');
    els.overlay.hidden = false;
    lastFocusedEl = document.activeElement;
    els.closePanelBtn.focus({ preventScroll: true });
  }
  function closePanel() {
    els.panel.classList.remove('is-open');
    els.panel.setAttribute('aria-hidden', 'true');
    els.overlay.hidden = true;
    currentPinId = null;
    els.copyLinkBtn.disabled = true;
    clearHash();
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus({ preventScroll: true });
    lastFocusedEl = null;
  }
  function setPanelContent(pin) {
    const title = pin?.title || 'Untitled';
    const dateStr = formatDate(pin?.date);
    const addr = pin?.address ? String(pin.address) : '';
    els.panelTitle.textContent = title;
    const metaParts = [];
    if (dateStr) metaParts.push(dateStr);
    if (addr) metaParts.push(addr);
    els.panelMeta.textContent = metaParts.join(' • ');
    els.captionText.textContent = pin?.caption ? String(pin.caption) : '';
    galleryImages = Array.isArray(pin?.images) ? pin.images.slice() : [];
        // Update duplicate elements for panel title, meta, and caption
    document.querySelectorAll('#panelTitle').forEach(el => { el.textContent = title; });
    document.querySelectorAll('#panelMeta').forEach(el => { el.textContent = metaParts.join(' \u2022 '); });
    document.querySelectorAll('#captionText').forEach(el => { el.textContent = pin?.caption ? String(pin.caption) : ''; });

    galleryIndex = 0;
    const hasMany = galleryImages.length > 1;
    els.prevImgBtn.disabled = !hasMany;
    els.nextImgBtn.disabled = !hasMany;
    renderGallery();
    els.copyLinkBtn.disabled = false;
  }
  function renderGallery() {
    if (!galleryImages.length) {
      els.galleryImg.removeAttribute('src');
      els.galleryImg.alt = '';
      els.galleryCounter.textContent = 'No images';
      return;
    }
    const src = String(galleryImages[galleryIndex]);
    els.galleryImg.src = src;
    els.galleryImg.alt = `Image ${galleryIndex + 1} of ${galleryImages.length}`;
    els.galleryCounter.textContent = `${galleryIndex + 1} / ${galleryImages.length}`;
  }
  function nextImage() {
    if (galleryImages.length <= 1) return;
    galleryIndex = (galleryIndex + 1) % galleryImages.length;
    renderGallery();
  }
  function prevImage() {
    if (galleryImages.length <= 1) return;
    galleryIndex = (galleryIndex - 1 + galleryImages.length) % galleryImages.length;
    renderGallery();
  }
  async function copyDeepLink(pinId) {
    const url = new URL(window.location.href);
    url.hash = `pin=${encodeURIComponent(pinId)}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      const old = els.copyLinkBtn.textContent;
      els.copyLinkBtn.textContent = 'Copied \u2713';
      setTimeout(() => (els.copyLinkBtn.textContent = old), 900);
    } catch {
      window.prompt('Copy this link:', url.toString());
    }
  }
  function flyToMarker(marker) {
    const ll = marker.getLatLng();
    const opts = prefersReducedMotion ? { animate: false } : { animate: true, duration: 0.8 };
    const targetZoom = clamp(map.getZoom() + 1, 12, 16);
    if (prefersReducedMotion) {
      map.setView(ll, targetZoom, { animate: false });
    } else {
      map.flyTo(ll, targetZoom, opts);
    }
  }
  function highlightMarkers(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      pinIndex.forEach(({ marker }) => {
        if (marker._icon) marker._icon.classList.remove('pin--match');
      });
      return;
    }
    pinIndex.forEach(({ pin, marker }) => {
      const match = String(pin.title || '').toLowerCase().includes(q);
      if (marker._icon) marker._icon.classList.toggle('pin--match', match);
    });
  }
  function normalizeSearchUI() {
    const hasText = Boolean(els.searchInput.value.trim());
    els.clearSearchBtn.hidden = !hasText;
  }
  function makeDivIcon(type) {
    const cls = type === 'home' ? 'pin pin--home' : 'pin';
    return L.divIcon({ className: cls, iconSize: [20, 20], iconAnchor: [10, 10] });
  }
  function addMarkerA11y(marker, pin) {
    marker.on('add', () => {
      const el = marker._icon;
      if (!el) return;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `Open details for ${pin.title}`);
    });
    marker.on('keypress', (e) => {
      const key = e?.originalEvent?.key;
      if (key === 'Enter') openPin(pin.id, { fromHash: false });
    });
  }
  function openPin(pinId, { fromHash } = { fromHash: false }) {
    const entry = pinIndex.get(pinId);
    if (!entry) return;
    currentPinId = pinId;
    setPanelContent(entry.pin);
    openPanel();
    if (!fromHash) setHashPinId(pinId);
    flyToMarker(entry.marker);
  }

  // ----------------------------
  // Init Map
  // ----------------------------
  function initMap() {
    map = L.map(els.map, {
      zoomControl: true,
      preferCanvas: true,
      fadeAnimation: !prefersReducedMotion,
      zoomAnimation: !prefersReducedMotion,
      markerZoomAnimation: !prefersReducedMotion,
    }).setView([OKHTYRKA_FALLBACK.lat, OKHTYRKA_FALLBACK.lng], OKHTYRKA_FALLBACK.zoom);

    setTheme(currentTheme);

    markerContainer = (typeof L.markerClusterGroup === 'function')
      ? L.markerClusterGroup({ showCoverageOnHover: false })
      : L.layerGroup();
    markerContainer.addTo(map);
    els.overlay.addEventListener('click', closePanel);
  }

  // ----------------------------
  // Load Pins + Build Markers
  // ----------------------------
  async function loadPins() {
    const res = await fetch('pins.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load pins.json (${res.status})`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('pins.json must be an array');
    pins = data;
    const boundsPoints = [];
    pins.forEach((pin) => {
      if (!pin || !pin.id) return;
      if (!isValidCoords(pin.coords)) return;
      const icon = makeDivIcon(pin.type);
      const marker = L.marker([pin.coords[0], pin.coords[1]], {
        icon,
        title: pin.title || pin.id,
        keyboard: true,
        riseOnHover: true,
      });
      marker.on('click', () => openPin(pin.id, { fromHash: false }));
      addMarkerA11y(marker, pin);
      marker.addTo(markerContainer);
      pinIndex.set(pin.id, { pin, marker });
      boundsPoints.push([pin.coords[0], pin.coords[1]]);
    });
    if (boundsPoints.length) {
      const bounds = L.latLngBounds(boundsPoints);
      map.fitBounds(bounds, {
        padding: [40, 40],
        maxZoom: 15,
        animate: !prefersReducedMotion,
      });
    }
  }

  // ----------------------------
  // Deep link handling
  // ----------------------------
  function handleHash() {
    const id = getHashPinId();
    if (!id) return;
    if (pinIndex.has(id)) openPin(id, { fromHash: true });
  }

  // ----------------------------
  // Events
  // ----------------------------
  function bindUI() {
    els.themeToggle.addEventListener('click', () => {
      setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
    els.closePanelBtn.addEventListener('click', closePanel);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (els.panel.classList.contains('is-open')) closePanel();
      }
    });
    els.copyLinkBtn.addEventListener('click', () => {
      if (!currentPinId) return;
      setHashPinId(currentPinId);
      copyDeepLink(currentPinId);
    });
    window.addEventListener('hashchange', () => {
      const id = getHashPinId();
      if (!id) {
        if (els.panel.classList.contains('is-open')) closePanel();
        return;
      }
      if (pinIndex.has(id)) openPin(id, { fromHash: true });
    });
    els.nextImgBtn.addEventListener('click', nextImage);
    els.prevImgBtn.addEventListener('click', prevImage);
    els.galleryViewport.addEventListener('touchstart', (e) => {
      if (!galleryImages.length) return;
      swiping = true;
      swipeX0 = e.touches[0].clientX;
      swipeX1 = swipeX0;
    }, { passive: true });
    els.galleryViewport.addEventListener('touchmove', (e) => {
      if (!swiping) return;
      swipeX1 = e.touches[0].clientX;
    }, { passive: true });
    els.galleryViewport.addEventListener('touchend', () => {
      if (!swiping) return;
      swiping = false;
      const dx = swipeX1 - swipeX0;
      const threshold = 42;
      if (Math.abs(dx) < threshold) return;
      if (dx < 0) nextImage();
      else prevImage();
    });
    els.searchInput.addEventListener('input', () => {
      normalizeSearchUI();
      highlightMarkers(els.searchInput.value);
    });
    els.clearSearchBtn.addEventListener('click', () => {
      els.searchInput.value = '';
      normalizeSearchUI();
      highlightMarkers('');
      els.searchInput.focus();
    });
  }

  // ----------------------------
  // Boot
  // ----------------------------
  async function main() {
    currentTheme = loadInitialTheme();
    document.documentElement.setAttribute('data-theme', currentTheme);
    initMap();
    bindUI();
    try {
      await loadPins();
      handleHash();
    } catch (err) {
      console.error(err);
      els.panelTitle.textContent = 'Could not load pins';
      els.captionText.textContent = 'Run this site via a local server (not file://). Check the console for details.';
      openPanel();
    }
  }
  main();
})();
