const router = require('express').Router();
const db = require('../db');

/**
 * GET /directions/:id/route
 * :id = id de line_routes (line_direction_id)
 * Devuelve geometría + meta.
 */
router.get('/:id/route', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ ok: false, error: 'id inválido' });
        }

        const sql = `
      SELECT
        lr.id AS line_direction_id,
        lr.line_id,
        lr.direction,
        CASE WHEN lr.direction='outbound' THEN 'Ida' ELSE 'Vuelta' END AS headsign,
        l.code,
        l.name AS line_name,
        l.color_hex,
        ROUND(lr.length_m)::int AS length_m,
        ST_AsGeoJSON(lr.geom)::json AS geom
      FROM line_routes lr
      JOIN lines l ON l.id = lr.line_id
      WHERE lr.id = $1
    `;
        const { rows } = await db.query(sql, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'direction not found' });
        }
        const r = rows[0];

        return res.json({
            ok: true,
            direction: {
                line_direction_id: r.line_direction_id,
                line_id: r.line_id,
                direction: r.direction,
                headsign: r.headsign,
                code: r.code,
                line_name: r.line_name,
                color_hex: r.color_hex,
                length_m: r.length_m
            },
            geometry: r.geom,
            segments: 1,
            length_m_total: r.length_m
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;