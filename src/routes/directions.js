const router = require('express').Router();
const db = require('../db');

// POST /directions - crea una dirección para una línea
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
        if (e.code === '23503') {
            return res.status(400).json({ ok: false, error: 'line_id no existe' });
        }
        if (e.code === '23505') {
            return res.status(409).json({ ok: false, error: 'Ya existe esa dirección para la línea' });
        }
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /directions/:id/route (ya lo tienes)
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
        if (meta.rowCount === 0) {
            return res.status(404).json({ ok: false, error: 'direction not found' });
        }
        const direction = meta.rows[0];

        const agg = await db.query(
            `SELECT
                 COUNT(*)::int AS segments,
                 COALESCE(ROUND(SUM(length_m))::int, 0) AS length_m_total,
                 CASE
                     WHEN COUNT(*) > 0
                         THEN ST_AsGeoJSON(ST_LineMerge(ST_Union(geom)))::json
                     ELSE NULL
                     END AS geometry
             FROM shapes
             WHERE line_direction_id = $1`,
            [id]
        );

        const { segments, length_m_total, geometry } = agg.rows[0];

        return res.json({
            ok: true,
            direction,
            segments,
            length_m_total,
            geometry
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;