const router = require('express').Router();
const db = require('../db');

router.get('/', async (_req, res) => {
    try {
        const { rows } = await db.query(`
      SELECT
        l.id AS line_id,
        l.code,
        l.name,
        l.color_hex,
        ld.id AS line_direction_id,
        ld.direction,
        ld.headsign,
        ld.avg_speed_kmh,
        ld.wait_minutes
      FROM lines l
      JOIN line_directions ld ON ld.line_id = l.id
      WHERE l.is_active AND ld.is_active
      ORDER BY l.name, ld.direction
    `);
        res.json({ ok: true, data: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;