const fs = require('fs');
const path = require('path');

// Guardamos fuera de src para que nodemon no reinicie
const VAR_DIR = path.join(__dirname, '..', '..', 'var');
if (!fs.existsSync(VAR_DIR)) {
    try { fs.mkdirSync(VAR_DIR); } catch (_) {}
}

const CACHE_FILE = path.join(VAR_DIR, 'data_place_cache.json');

let placeCache = {}; // key -> {lng,lat,hits,first_seen,last_seen}

// Bounding box (mantener sincronizado con chat.js)
const CITY_BBOX = {
    minLng: -66.25,
    maxLng: -66.05,
    minLat: -17.50,
    maxLat: -17.25
};
function inCityBounds(lng, lat) {
    return lng >= CITY_BBOX.minLng && lng <= CITY_BBOX.maxLng &&
        lat >= CITY_BBOX.minLat && lat <= CITY_BBOX.maxLat;
}

function normalizeKey(s) {
    return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function loadPlaceCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const raw = fs.readFileSync(CACHE_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (data && typeof data === 'object') {
                placeCache = data;
            }
        }
    } catch (_) {}
}

function purgeOutOfBoundsFromCache() {
    let removed = 0;
    for (const [k, v] of Object.entries(placeCache)) {
        if (!inCityBounds(v.lng, v.lat)) {
            delete placeCache[k];
            removed++;
        }
    }
    if (removed > 0) {
        try { fs.writeFileSync(CACHE_FILE, JSON.stringify(placeCache, null, 2)); } catch (_) {}
    }
}

let persistTimer = null;
function schedulePersistPlaceCache() {
    if (persistTimer) return;
    persistTimer = setInterval(() => {
        try {
            fs.writeFileSync(CACHE_FILE, JSON.stringify(placeCache, null, 2));
        } catch (_) {}
    }, 20000);
}

function getCachedPlace(label) {
    const key = normalizeKey(label);
    const entry = placeCache[key];
    if (!entry) return null;
    entry.hits++;
    entry.last_seen = Date.now();
    return { lng: entry.lng, lat: entry.lat };
}

function setCachedPlace(label, { lng, lat }) {
    if (!inCityBounds(lng, lat)) return;
    const key = normalizeKey(label);
    if (!placeCache[key]) {
        placeCache[key] = {
            lng,
            lat,
            hits: 1,
            first_seen: Date.now(),
            last_seen: Date.now()
        };
    } else {
        placeCache[key].hits++;
        placeCache[key].last_seen = Date.now();
    }
}

module.exports = {
    loadPlaceCache,
    schedulePersistPlaceCache,
    getCachedPlace,
    setCachedPlace,
    purgeOutOfBoundsFromCache
};