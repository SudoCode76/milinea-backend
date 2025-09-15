const router = require('express').Router();
const db = require('../db');

// POST /directions - crear dirección (ya existente en tu repo)
router.post('/', async (req, res) => {
    try {
        const { line_id, direction, headsign, avg_speed_kmh = 20, wait_minutes = 5, is_active = true } = req.body || {};
        if (!Number.isInteger(line_id) || line_id <= 0) {
            return res.status(400).json({ ok: false, error: 'line_id inválido' });
        }
        if (!['outbound', 'inbound'].includes(direction)) {
            return res.status(400).json({ ok: false, error: "direction debe ser 'outbound' o 'inbound'" });
        }
        if (!headsign) {
            return res.status(400).json({ ok: false, error: 'headsign es obligatorio' });
        }

        const rs = await db.query(
            `INSERT INTO line_directions (line_id, direction, headsign, avg_speed_kmh, wait_minutes, is_active)
             VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *;`,
            [line_id, direction, headsign, avg_speed_kmh, wait_minutes, is_active]
        );

        res.status(201).json({ ok: true, direction: rs.rows[0] });
    } catch (e) {
        if (e.code === '23503') return res.status(400).json({ ok: false, error: 'line_id no existe' });
        if (e.code === '23505') return res.status(409).json({ ok: false, error: 'Ya existe esa dirección para la línea' });
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /directions/:id/route - geometría unificada
router.get('/:id/route', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ ok: false, error: 'id inválido' });
        }

        const meta = await db.query(
            `SELECT
                 ld.id,
                 ld.line_id,
                 l.name  AS line_name,
                 l.code,
                 l.color_hex,
                 ld.direction,
                 ld.headsign
             FROM line_directions ld
                      JOIN lines l ON l.id = ld.line_id
             WHERE ld.id = $1`,
            [id]
        );
        if (meta.rowCount === 0) return res.status(404).json({ ok: false, error: 'direction not found' });
        const direction = meta.rows[0];

        const agg = await db.query(
            `SELECT
                 COUNT(*)::int AS segments,
                 COALESCE(ROUND(SUM(length_m))::int, 0) AS length_m_total,
                 CASE WHEN COUNT(*) > 0
                          THEN ST_AsGeoJSON(ST_LineMerge(ST_Union(geom)))::json
                      ELSE NULL
                     END AS geometry
             FROM shapes
             WHERE line_direction_id = $1`,
            [id]
        );

        const { segments, length_m_total, geometry } = agg.rows[0];

        // Cache 5 minutos
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');

        return res.json({ ok: true, direction, segments, length_m_total, geometry });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// NUEVO: GET /directions/bbox?bbox=west,south,east,north
router.get('/bbox/within', async (req, res) => {
    try {
        const bboxStr = String(req.query.bbox || '');
        const parts = bboxStr.split(',').map(Number);
        if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
            return res.status(400).json({ ok: false, error: 'bbox inválido. Formato: west,south,east,north' });
        }
        const [w, s, e, n] = parts;

        const sql = `
      WITH env AS (SELECT ST_MakeEnvelope($1,$2,$3,$4,4326) AS box)
      SELECT
        ld.id AS line_direction_id,
        l.name AS line_name,
        l.code,
        l.color_hex,
        ld.direction,
        ld.headsign,
        COUNT(s.*)::int AS segments,
        COALESCE(ROUND(SUM(s.length_m))::int, 0) AS length_m_total,
        ST_AsGeoJSON(ST_LineMerge(ST_Union(s.geom)))::json AS geometry
      FROM line_directions ld
      JOIN lines l ON l.id = ld.line_id
      JOIN shapes s ON s.line_direction_id = ld.id
      CROSS JOIN env
      WHERE l.is_active AND ld.is_active
        AND ST_Intersects(s.geom, env.box)
      GROUP BY ld.id, l.name, l.code, l.color_hex, ld.direction, ld.headsign
      ORDER BY l.name, ld.direction
      LIMIT 200;
    `;
        const { rows } = await db.query(sql, [w, s, e, n]);

        res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
        res.json({
            ok: true,
            bbox: { west: w, south: s, east: e, north: n },
            count: rows.length,
            features: rows.map(r => ({
                type: 'Feature',
                geometry: r.geometry,
                properties: {
                    line_direction_id: r.line_direction_id,
                    line_name: r.line_name,
                    code: r.code,
                    color_hex: r.color_hex,
                    direction: r.direction,
                    headsign: r.headsign,
                    segments: r.segments,
                    length_m_total: r.length_m_total
                }
            })),
            type: 'FeatureCollection'
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;