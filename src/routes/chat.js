const router = require('express').Router();
const db = require('../db');
const { GEMINI_KEY, MAPBOX_TOKEN, WALK_KMH, THRESHOLD_M, BUS_KMH } = require('../config');

// Llamada a Gemini
async function geminiExtractDestination({ message, model = 'gemini-1.5-flash' }) {
    if (!GEMINI_KEY) throw new Error('GEMINI_KEY no configurada');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
    const system = `Eres un asistente de movilidad urbana. Extrae solo el destino si el usuario pide ir a algún lugar.
Responde estrictamente en JSON con este shape:
{"destination_text": "<texto del destino o \\"\\" si no hay destino>", "language": "es"}
No incluyas nada más.`;
    const body = {
        contents: [{ role: 'user', parts: [{ text: `${system}\n\nUsuario: ${message}` }] }],
        generationConfig: { responseMimeType: 'application/json' }
    };
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`Gemini error ${resp.status}: ${txt}`);
    }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed = {};
    try { parsed = JSON.parse(text); } catch { parsed = { destination_text: '' }; }
    return { destination_text: String(parsed.destination_text || '').trim(), raw: parsed };
}

// Geocoding Mapbox
async function geocodeWithMapbox(query) {
    if (!MAPBOX_TOKEN) throw new Error('MAPBOX_TOKEN no configurado');
    const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&limit=1&language=es`;
    const resp = await fetch(endpoint);
    if (!resp.ok) throw new Error(`Mapbox geocoding error ${resp.status}`);
    const j = await resp.json();
    const feat = j.features?.[0];
    if (!feat?.center) return null;
    const [lng, lat] = feat.center;
    return { lng: Number(lng), lat: Number(lat), place_name: feat.place_name };
}

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

// POST /chat
router.post('/', async (req, res) => {
    try {
        const { message, origin, threshold_m, walk_kmh, bus_kmh } = req.body || {};
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ ok: false, error: 'message requerido' });
        }

        // 1) intención
        const intent = await geminiExtractDestination({ message });
        if (!intent.destination_text) {
            return res.json({ ok: true, needs: { destination: true }, reply: '¿A qué lugar quieres ir? Escribe la dirección o nombre.' });
        }

        // 2) geocodificar destino
        const dest = await geocodeWithMapbox(intent.destination_text);
        if (!dest) return res.json({ ok: true, intent, reply: `No encontré "${intent.destination_text}". ¿Puedes ser más preciso?` });

        // 3) validar origen
        let o = null;
        if (origin && Number.isFinite(origin.lng) && Number.isFinite(origin.lat)) {
            o = { lng: Number(origin.lng), lat: Number(origin.lat) };
        } else {
            return res.json({ ok: true, intent, destination: dest, needs: { origin: true }, reply: 'Perfecto. Envíame tu ubicación actual para calcular la mejor línea.' });
        }

        // 4) calcular
        const thr = Number(threshold_m ?? THRESHOLD_M);
        const walk = Number(walk_kmh ?? WALK_KMH);
        const bus = Number(bus_kmh ?? BUS_KMH);
        const walk_m_per_min = (walk * 1000) / 60.0;
        const bus_m_per_min = (bus * 1000) / 60.0;

        const { rows } = await db.query(FASTEST_SQL, [o.lng, o.lat, dest.lng, dest.lat, thr, walk_m_per_min, bus_m_per_min]);

        let reply = `Tengo ${rows.length} opción(es). `;
        if (rows.length > 0) {
            const best = rows[0];
            reply += `La mejor es la línea ${best.code} (${best.line_name}), ${best.headsign}. Tiempo estimado: ${best.eta_minutes.toFixed(1)} min.`;
        } else {
            reply = 'No encontré líneas cercanas para ese trayecto.';
        }

        res.json({
            ok: true,
            intent,
            origin: o,
            destination: dest,
            params: { threshold_m: thr, walk_kmh: walk, bus_kmh: bus },
            fastest: { results: rows, best: rows[0] || null },
            reply
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;