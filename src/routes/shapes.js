const router = require('express').Router();
const db = require('../db');

// Normaliza coordinates: acepta [{lng,lat}, ...] o [[lng,lat], ...]
function normalizeCoords(input) {
    if (!Array.isArray(input)) return null;
    const out = [];
    for (const p of input) {
        if (Array.isArray(p) && p.length >= 2) {
            const [lng, lat] = p;
            out.push([Number(lng), Number(lat)]);
        } else if (p && typeof p === 'object' && 'lng' in p && 'lat' in p) {
            out.push([Number(p.lng), Number(p.lat)]);
        } else {
            return null;
        }
    }
    return out;
}

function validateLngLat([lng, lat]) {
    return (
        Number.isFinite(lng) &&
        Number.isFinite(lat) &&
        lng >= -180 && lng <= 180 &&
        lat >= -90 && lat <= 90
    );
}

function toLineStringWKT(coords) {
    // coords: [[lng,lat], ...] con al menos 2 puntos
    const parts = coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ');
    return `LINESTRING(${parts})`;
}

// POST /shapes  -> crea o actualiza (si upsert=true) el shape de una dirección
// Body:
// {
//   "line_direction_id": 1,
//   "seq": 1,
//   "coordinates": [[-66.19,-17.41],[-66.175,-17.405],[-66.16,-17.395],[-66.15,-17.39]],
//   "upsert": true
// }
router.post('/', async (req, res) => {
    try {
        const { line_direction_id, seq = 1, coordinates, upsert = false } = req.body || {};

        const dirId = Number(line_direction_id);
        const seqNum = Number(seq);

        if (!Number.isInteger(dirId) || dirId <= 0) {
            return res.status(400).json({ ok: false, error: 'line_direction_id inválido' });
        }
        if (!Number.isInteger(seqNum) || seqNum <= 0) {
            return res.status(400).json({ ok: false, error: 'seq debe ser entero >= 1' });
        }

        const coords = normalizeCoords(coordinates);
        if (!coords || coords.length < 2) {
            return res.status(400).json({ ok: false, error: 'coordinates debe tener al menos 2 puntos [lng,lat] o {lng,lat}' });
        }
        for (const c of coords) {
            if (!validateLngLat(c)) {
                return res.status(400).json({ ok: false, error: `coordenada inválida: ${JSON.stringify(c)}` });
            }
        }

        const wkt = toLineStringWKT(coords);

        const baseSql = `
      INSERT INTO shapes (line_direction_id, seq, geom)
      VALUES ($1, $2, ST_GeomFromText($3, 4326)::geometry(LineString,4326))
      ${upsert ? 'ON CONFLICT (line_direction_id, seq) DO UPDATE SET geom = EXCLUDED.geom, updated_at = NOW()' : ''}
      RETURNING
        id, line_direction_id, seq,
        ROUND(length_m)::int AS length_m,
        ST_AsGeoJSON(geom)::json AS geom_geojson
    `;

        const { rows } = await db.query(baseSql, [dirId, seqNum, wkt]);
        res.status(upsert ? 200 : 201).json({ ok: true, data: rows[0] });
    } catch (e) {
        // Mensaje más amigable para FK o constraint
        if (e.code === '23503') {
            return res.status(400).json({ ok: false, error: 'line_direction_id no existe' });
        }
        if (e.code === '23505') {
            return res.status(409).json({ ok: false, error: 'Ya existe un shape con ese (line_direction_id, seq). Usa upsert=true para reemplazar.' });
        }
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /shapes/:line_direction_id -> lista shapes de esa dirección (GeoJSON incluido)
router.get('/:line_direction_id', async (req, res) => {
    try {
        const id = Number(req.params.line_direction_id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ ok: false, error: 'line_direction_id inválido' });
        }
        const { rows } = await db.query(
            `SELECT id, line_direction_id, seq,
              ROUND(length_m)::int AS length_m,
              ST_AsGeoJSON(geom)::json AS geom_geojson
       FROM shapes
       WHERE line_direction_id = $1
       ORDER BY seq ASC`,
            [id]
        );
        res.json({ ok: true, count: rows.length, data: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;