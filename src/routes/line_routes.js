const router = require('express').Router();
const db = require('../db');

// Helpers
function normalizeFCorGeom(body) {
    // Acepta:
    // - featureCollection: {type:'FeatureCollection', features:[{geometry:{type:'LineString', coordinates:[[lng,lat],...]}}]}
    // - geometry: {type:'LineString', coordinates:[[lng,lat],...]}
    // - coordinates: [[lng,lat], ...]
    let coords = null;

    if (body?.featureCollection && body.featureCollection.type === 'FeatureCollection') {
        const feat = (body.featureCollection.features || []).find(f => f?.geometry?.type === 'LineString');
        if (feat?.geometry?.coordinates) coords = feat.geometry.coordinates;
    } else if (body?.geometry?.type === 'LineString' && Array.isArray(body.geometry.coordinates)) {
        coords = body.geometry.coordinates;
    } else if (Array.isArray(body?.coordinates)) {
        coords = body.coordinates;
    }

    if (!Array.isArray(coords) || coords.length < 2) return null;
    // Validación básica
    const norm = coords.map(p => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null);
    if (norm.some(v => !v || !Number.isFinite(v[0]) || !Number.isFinite(v[1]) || v[0] < -180 || v[0] > 180 || v[1] < -90 || v[1] > 90)) {
        return null;
    }
    return norm;
}

function toWKT(coords) {
    return `LINESTRING(${coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ')})`;
}

// POST /line-routes
// Body: { line_id:number, direction:'outbound'|'inbound', featureCollection|geometry|coordinates }
router.post('/', async (req, res) => {
    try {
        const { line_id, direction } = req.body || {};
        const id = Number(line_id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'line_id inválido' });
        if (!['outbound', 'inbound'].includes(direction)) return res.status(400).json({ ok: false, error: "direction debe ser 'outbound' o 'inbound'" });

        const coords = normalizeFCorGeom(req.body);
        if (!coords) return res.status(400).json({ ok: false, error: 'Se requiere LineString (coordinates) con al menos 2 puntos [lng,lat]' });

        const wkt = toWKT(coords);
        const sql = `
      INSERT INTO line_routes (line_id, direction, geom)
      VALUES ($1, $2, ST_GeomFromText($3,4326)::geometry(LineString,4326))
      ON CONFLICT (line_id, direction)
      DO UPDATE SET geom = EXCLUDED.geom, updated_at = NOW()
      RETURNING id, line_id, direction, ROUND(length_m)::int AS length_m, ST_AsGeoJSON(geom)::json AS geom
    `;
        const { rows } = await db.query(sql, [id, direction, wkt]);
        const r = rows[0];

        // Devuelve como FeatureCollection (sin extras)
        res.status(201).json({
            ok: true,
            route: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    id: r.id,
                    properties: {},
                    geometry: r.geom
                }]
            },
            meta: { line_id: r.line_id, direction: r.direction, length_m: r.length_m }
        });
    } catch (e) {
        if (e.code === '23503') return res.status(400).json({ ok: false, error: 'line_id no existe' });
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /line-routes/:line_id/:direction
router.get('/:line_id/:direction', async (req, res) => {
    try {
        const line_id = Number(req.params.line_id);
        const { direction } = req.params;
        if (!Number.isInteger(line_id) || line_id <= 0) return res.status(400).json({ ok: false, error: 'line_id inválido' });
        if (!['outbound', 'inbound'].includes(direction)) return res.status(400).json({ ok: false, error: "direction debe ser 'outbound' o 'inbound'" });

        const { rows } = await db.query(
            `SELECT id, ST_AsGeoJSON(geom)::json AS geom FROM line_routes WHERE line_id=$1 AND direction=$2`,
            [line_id, direction]
        );
        if (rows.length === 0) return res.status(404).json({ ok: false, error: 'route not found' });

        const r = rows[0];
        res.json({
            ok: true,
            route: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    id: r.id,
                    properties: {},
                    geometry: r.geom
                }]
            }
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /line-routes/:line_id
router.get('/:line_id', async (req, res) => {
    try {
        const line_id = Number(req.params.line_id);
        if (!Number.isInteger(line_id) || line_id <= 0) return res.status(400).json({ ok: false, error: 'line_id inválido' });

        const { rows } = await db.query(
            `SELECT id, direction, ST_AsGeoJSON(geom)::json AS geom
       FROM line_routes WHERE line_id=$1`, [line_id]);

        const toFC = (id, geom) => ({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', id, properties: {}, geometry: geom }]
        });

        const outbound = rows.find(r => r.direction === 'outbound');
        const inbound = rows.find(r => r.direction === 'inbound');

        res.json({
            ok: true,
            routes: {
                outbound: outbound ? toFC(outbound.id, outbound.geom) : null,
                inbound: inbound ? toFC(inbound.id, inbound.geom) : null
            }
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;