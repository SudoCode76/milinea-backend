const router = require('express').Router();
const db = require('../db');
const {
    GEMINI_KEY,
    MAPBOX_TOKEN,
    WALK_KMH,
    THRESHOLD_M,
    BUS_KMH
} = require('../config');

const {
    getCachedPlace,
    setCachedPlace,
    loadPlaceCache,
    schedulePersistPlaceCache,
    purgeOutOfBoundsFromCache
} = require('../services/cache_places');
const {
    registerUnresolved,
    purgeUnresolvedOld,
    loadUnresolvedCache,
    schedulePersistUnresolved
} = require('../services/unresolved_terms');
const { extractTrip } = require('../services/extract_trip_fallback');

// Debug
const DEBUG_CHAT = process.env.DEBUG_CHAT === '1' || process.env.NODE_ENV === 'development';
function dbg(...a) { if (DEBUG_CHAT) console.log('[CHAT-DBG]', ...a); }

// Init caches
loadPlaceCache();
purgeOutOfBoundsFromCache();
schedulePersistPlaceCache();
loadUnresolvedCache();
schedulePersistUnresolved();
purgeUnresolvedOld();

// Sessions
const sessions = new Map();
function ensureSession(id) {
    if (!id) return null;
    let s = sessions.get(id);
    if (!s) {
        s = { id, origin: null, destination: null, updated_at: Date.now() };
        sessions.set(id, s);
    } else {
        s.updated_at = Date.now();
    }
    return s;
}
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
        if (now - s.updated_at > 30 * 60 * 1000) sessions.delete(id);
    }
}, 15 * 60 * 1000);

// City bounds
const CITY_BBOX = { minLng: -66.25, maxLng: -66.05, minLat: -17.50, maxLat: -17.25 };
function inCityBounds(lng, lat) {
    return lng >= CITY_BBOX.minLng && lng <= CITY_BBOX.maxLng &&
        lat >= CITY_BBOX.minLat && lat <= CITY_BBOX.maxLat;
}

// Sanitizer
function sanitizePlaceText(txt) {
    if (!txt) return '';
    let t = txt.trim().toLowerCase();
    t = t.replace(/^(?:de|del|la|el|los|las|al)\s+/g, '');
    t = t.replace(/^(?:de|del|la|el|los|las|al)\s+/g, '');
    return t.trim();
}

// Gemini call (first model, optional second if 404)
async function geminiCall(model, message) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
    const prompt = `
Eres un asistente de movilidad urbana en Cochabamba.
Devuelve SOLO JSON con origen/destino si el usuario pide una ruta.

Formato JSON EXACTO:
{
 "origin_text": "...",
 "destination_text": "...",
 "places_detected": ["..."],
 "intent": "route" | "smalltalk" | "unknown",
 "language": "es"
}

Mensaje:
"""${message}"""
`;
    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
    };
    const resp = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!resp.ok) {
        const txt = await resp.text().catch(()=> '');
        const err = new Error(`Gemini error ${resp.status}: ${txt}`);
        err.status = resp.status;
        throw err;
    }
    const data = await resp.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    return {
        origin_text: (parsed.origin_text || '').trim(),
        destination_text: (parsed.destination_text || '').trim(),
        intent: parsed.intent || 'unknown',
        language: parsed.language || 'es',
        raw: parsed
    };
}

async function extractTripWithFallback(message) {
    // 1. Fallback primero (barato)
    const fb = extractTrip(message);

    // 2. Si no hay GEMINI_KEY -> usar solo fallback
    if (!GEMINI_KEY) {
        fb.used = 'fallback-only';
        return fb;
    }

    // 3. Intentar modelos Gemini
    const models = ['gemini-1.5-flash', 'gemini-1.5-flash-latest'];
    let gRes = null;
    let lastErr = null;

    for (const m of models) {
        try {
            gRes = await geminiCall(m, message);
            gRes.model_used = m;
            break;
        } catch (e) {
            lastErr = e;
            if (e.status && e.status !== 404) break; // si no es 404 no seguimos
        }
    }

    if (!gRes) {
        // Gemini no funcionó
        fb.used = 'fallback-error-gemini';
        fb.gemini_error = lastErr?.message;
        return fb;
    }

    // 4. Si Gemini dio "route" y extrajo campos, preferirlo
    if (gRes.intent === 'route' &&
        (gRes.origin_text || gRes.destination_text)) {
        gRes.used = 'gemini';
        return gRes;
    }

    // 5. Si fallback detectó ruta y Gemini no
    if (fb.intent === 'route' && (fb.origin_text || fb.destination_text)) {
        fb.used = 'fallback-after-gemini';
        fb.gemini_raw = gRes.raw;
        return fb;
    }

    // 6. Ninguno detectó nada
    return {
        origin_text: '',
        destination_text: '',
        intent: 'unknown',
        language: 'es',
        used: 'none',
        gemini_raw: gRes.raw
    };
}

// Geocoding
async function geocodeWithMapbox(query) {
    if (!MAPBOX_TOKEN) return null;
    const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&limit=1&language=es&proximity=-66.157,-17.39`;
    const resp = await fetch(endpoint);
    if (!resp.ok) return null;
    const j = await resp.json();
    const feat = j.features?.[0];
    if (!feat?.center) return null;
    const [lng, lat] = feat.center;
    return { lng: Number(lng), lat: Number(lat), place_name: feat.place_name };
}

// Resolver lugar
async function resolvePlaceSmart(labelRaw) {
    if (!labelRaw) return null;
    const original = labelRaw.trim();
    if (!original) return null;

    const cached = getCachedPlace(original);
    if (cached && inCityBounds(cached.lng, cached.lat)) {
        dbg('CACHE HIT', original, cached);
        return { lng: cached.lng, lat: cached.lat, label: original, source: 'cache' };
    }

    let direct = await geocodeWithMapbox(original).catch(()=>null);
    dbg('GEOCODE DIRECT', original, direct);
    if (direct && inCityBounds(direct.lng, direct.lat)) {
        setCachedPlace(original, { lng: direct.lng, lat: direct.lat });
        return { lng: direct.lng, lat: direct.lat, label: original, source: 'geocode' };
    }

    const sanitized = sanitizePlaceText(original);
    if (sanitized && sanitized !== original) {
        const withCtx = await geocodeWithMapbox(sanitized + ' Cochabamba Bolivia').catch(()=>null);
        dbg('GEOCODE SANITIZED+CTX', sanitized, withCtx);
        if (withCtx && inCityBounds(withCtx.lng, withCtx.lat)) {
            setCachedPlace(original, { lng: withCtx.lng, lat: withCtx.lat });
            setCachedPlace(sanitized, { lng: withCtx.lng, lat: withCtx.lat });
            return { lng: withCtx.lng, lat: withCtx.lat, label: original, source: 'sanitized+context' };
        }
    }

    if (direct && !inCityBounds(direct.lng, direct.lat)) {
        const reCtx = await geocodeWithMapbox(original + ' Cochabamba Bolivia').catch(()=>null);
        dbg('GEOCODE DIRECT+CTX', original, reCtx);
        if (reCtx && inCityBounds(reCtx.lng, reCtx.lat)) {
            setCachedPlace(original, { lng: reCtx.lng, lat: reCtx.lat });
            return { lng: reCtx.lng, lat: reCtx.lat, label: original, source: 'context-appended' };
        }
    }

    return null;
}

// SQL
const FASTEST_SQL = `
  WITH
  params AS (
    SELECT
      ST_SetSRID(ST_MakePoint($1, $2), 4326) AS o_geom,
      ST_SetSRID(ST_MakePoint($3, $4), 4326) AS d_geom,
      $5::double precision AS threshold_m,
      $6::double precision AS walk_m_per_min,
      $7::double precision AS bus_m_per_min
  ),
  candidates AS (
    SELECT
      lr.id AS line_direction_id,
      l.id  AS line_id,
      l.name AS line_name,
      l.code,
      l.color_hex,
      lr.direction,
      lr.geom
    FROM line_routes lr
    JOIN lines l ON l.id = lr.line_id
    CROSS JOIN params p
    WHERE l.is_active
      AND ST_DWithin(lr.geom::geography, p.o_geom::geography, p.threshold_m)
      AND ST_DWithin(lr.geom::geography, p.d_geom::geography, p.threshold_m)
  ),
  measures AS (
    SELECT
      c.*,
      ST_LineLocatePoint(c.geom, p.o_geom) AS loc_o,
      ST_LineLocatePoint(c.geom, p.d_geom) AS loc_d,
      ST_ClosestPoint(c.geom, p.o_geom)    AS snap_o,
      ST_ClosestPoint(c.geom, p.d_geom)    AS snap_d
    FROM candidates c
    CROSS JOIN params p
  ),
  segments AS (
    SELECT
      m.*,
      ST_LineSubstring(m.geom, m.loc_o, m.loc_d) AS seg_geom
    FROM measures m
    WHERE m.loc_o < m.loc_d
  ),
  costs AS (
    SELECT
      s.*,
      ST_Length(s.seg_geom::geography) AS ride_m,
      ST_Distance(s.snap_o::geography, p.o_geom::geography) AS walk_to_m,
      ST_Distance(s.snap_d::geography, p.d_geom::geography) AS walk_from_m,
      ST_MakeLine(p.o_geom, s.snap_o) AS walk_to_geom,
      ST_MakeLine(s.snap_d, p.d_geom) AS walk_from_geom
    FROM segments s
    CROSS JOIN params p
  ),
  etas AS (
    SELECT
      c.line_direction_id,
      c.line_id,
      c.line_name,
      c.code,
      c.color_hex,
      c.direction,
      CASE WHEN c.direction='outbound' THEN 'Ida' ELSE 'Vuelta' END AS headsign,
      c.ride_m,
      c.walk_to_m,
      c.walk_from_m,
      (c.walk_to_m / p.walk_m_per_min)
      + (c.ride_m / p.bus_m_per_min)
      + (c.walk_from_m / p.walk_m_per_min) AS eta_minutes,
      ST_AsGeoJSON(c.seg_geom)::json   AS seg_geom_geojson,
      ST_AsGeoJSON(c.snap_o)::json     AS snap_o_geojson,
      ST_AsGeoJSON(c.snap_d)::json     AS snap_d_geojson,
      ST_AsGeoJSON(c.walk_to_geom)::json   AS walk_to_geojson,
      ST_AsGeoJSON(c.walk_from_geom)::json AS walk_from_geojson
    FROM costs c
    CROSS JOIN params p
  )
  SELECT *
  FROM etas
  ORDER BY eta_minutes ASC, (walk_to_m + walk_from_m) ASC, ride_m ASC
  LIMIT 5;
`;

function formatLinesReply(rows) {
    if (!rows || rows.length === 0) return 'No encontré líneas cercanas para ese trayecto.';
    const best = rows[0];
    if (rows.length === 1) return `Toma la línea ${best.code} (${best.headsign}). Tiempo estimado ${best.eta_minutes.toFixed(0)} min.`;
    const extras = rows.slice(1, Math.min(rows.length, 4))
        .map(r => `${r.code} ${r.headsign} ~${r.eta_minutes.toFixed(0)}m`).join(', ');
    return `La más rápida: ${best.code} (${best.headsign}) ~${best.eta_minutes.toFixed(0)} min. Otras: ${extras}.`;
}

// Endpoint
router.post('/', async (req, res) => {
    const started = Date.now();
    try {
        const { message, origin, threshold_m, walk_kmh, bus_kmh, session_id: clientSessionId } = req.body || {};
        dbg('RAW BODY', { message, origin, threshold_m, walk_kmh, bus_kmh, clientSessionId });

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ ok: false, error: 'message requerido' });
        }
        let sessionId = (typeof clientSessionId === 'string' && clientSessionId.trim()) || '';
        if (!sessionId) sessionId = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
        const session = ensureSession(sessionId);
        dbg('SESSION BEFORE', sessionId, { origin: session.origin, destination: session.destination });

        // Extracción (Gemini + fallback)
        const intentData = await extractTripWithFallback(message);
        dbg('EXTRACTED INTENT', intentData);

        if (intentData.intent === 'smalltalk') {
            return res.json({ ok: true, session_id: sessionId, intent: intentData, reply: 'Soy tu asistente de líneas. ¿A dónde quieres ir?' });
        }

        let originText = intentData.origin_text;
        let destinationText = intentData.destination_text;

        // Origen GPS
        let resolvedOrigin = null;
        if (origin && Number.isFinite(origin.lng) && Number.isFinite(origin.lat)) {
            if (inCityBounds(Number(origin.lng), Number(origin.lat))) {
                resolvedOrigin = { lng: Number(origin.lng), lat: Number(origin.lat), label: 'Tu ubicación', source: 'gps' };
                session.origin = resolvedOrigin;
            } else {
                dbg('GPS fuera de bounds', origin);
            }
        }

        // Resolver origen textual
        if (!resolvedOrigin && originText) {
            resolvedOrigin = await resolvePlaceSmart(originText);
            dbg('RESOLVED ORIGIN', originText, resolvedOrigin);
            if (resolvedOrigin) session.origin = resolvedOrigin;
            else registerUnresolved(originText);
        }

        // Destino
        if (!destinationText && !session.destination) {
            dbg('NEEDS DESTINATION');
            return res.json({
                ok: true,
                session_id: sessionId,
                intent: intentData,
                needs: { destination: true },
                reply: '¿A dónde quieres ir? (ej: "UMSS", "San Martín y Aroma")'
            });
        }

        let resolvedDestination = null;
        if (destinationText) {
            resolvedDestination = await resolvePlaceSmart(destinationText);
            dbg('RESOLVED DESTINATION', destinationText, resolvedDestination);
            if (resolvedDestination) session.destination = resolvedDestination;
            else {
                registerUnresolved(destinationText);
                return res.json({
                    ok: true,
                    session_id: sessionId,
                    intent: intentData,
                    needs: { destination: true },
                    reply: `No pude ubicar “${destinationText}”. Dame otra referencia cercana o un cruce.`
                });
            }
        } else if (session.destination) {
            resolvedDestination = session.destination;
            dbg('USING PREVIOUS DESTINATION', resolvedDestination);
        }

        if (!resolvedOrigin && session.origin) {
            resolvedOrigin = session.origin;
            dbg('USING PREVIOUS ORIGIN', resolvedOrigin);
        }

        if (resolvedDestination && !resolvedOrigin) {
            dbg('HAVE DEST NO ORIGIN');
            return res.json({
                ok: true,
                session_id: sessionId,
                intent: intentData,
                destination: resolvedDestination,
                needs: { origin: true },
                reply: `Envíame tu ubicación actual para calcular la mejor línea hacia ${resolvedDestination.label}.`
            });
        }

        if (!resolvedOrigin || !resolvedDestination) {
            dbg('FALTAN DATOS', { resolvedOrigin, resolvedDestination });
            return res.json({
                ok: true,
                session_id: sessionId,
                intent: intentData,
                needs: { origin: !resolvedOrigin, destination: !resolvedDestination },
                reply: 'Necesito origen y destino para calcular.'
            });
        }

        // Parámetros
        const thrBase = Number(threshold_m ?? THRESHOLD_M);
        const walk = Number(walk_kmh ?? WALK_KMH);
        const bus = Number(bus_kmh ?? BUS_KMH);
        const walk_m_per_min = (walk * 1000) / 60.0;
        const bus_m_per_min = (bus * 1000) / 60.0;

        let thresholdsToTry = [thrBase];
        if (thrBase < 250) thresholdsToTry = [thrBase, thrBase + 80, 300, 400];
        dbg('ROUTE PARAMS', { thresholdsToTry, origin: resolvedOrigin, destination: resolvedDestination });

        let rows = [];
        let usedThreshold = thrBase;
        for (const t of thresholdsToTry) {
            dbg('EXEC SQL threshold', t);
            const q = await db.query(FASTEST_SQL, [
                resolvedOrigin.lng,
                resolvedOrigin.lat,
                resolvedDestination.lng,
                resolvedDestination.lat,
                t,
                walk_m_per_min,
                bus_m_per_min
            ]);
            dbg('SQL ROWS', q.rows.length);
            if (q.rows.length > 0) {
                rows = q.rows;
                usedThreshold = t;
                break;
            }
        }

        const reply = rows.length === 0
            ? 'No encontré líneas cercanas para ese trayecto. Verifica que los puntos estén en la ciudad o da otra referencia.'
            : formatLinesReply(rows);

        return res.json({
            ok: true,
            session_id: sessionId,
            intent: intentData,
            origin: resolvedOrigin,
            destination: resolvedDestination,
            params: {
                threshold_m_initial: thrBase,
                threshold_m_used: usedThreshold,
                walk_kmh: walk,
                bus_kmh: bus
            },
            fastest: { results: rows, best: rows[0] || null },
            reply,
            meta: { elapsed_ms: Date.now() - started }
        });
    } catch (e) {
        dbg('ERROR /chat', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;