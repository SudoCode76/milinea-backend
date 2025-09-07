const router = require('express').Router();
const db = require('../db');

// GET /lines - lista líneas con direcciones
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

// POST /lines - crea una línea
router.post('/', async (req, res) => {
    try {
        const { code, name, color_hex, is_active = true } = req.body || {};
        if (!code || !name || !color_hex || !/^#[0-9A-Fa-f]{6}$/.test(color_hex)) {
            return res.status(400).json({ ok: false, error: 'code, name y color_hex (#RRGGBB) son obligatorios' });
        }

        const result = await db.query(
            `INSERT INTO lines (code, name, color_hex, is_active)
             VALUES ($1, $2, $3, $4)
                 RETURNING *;`,
            [code, name, color_hex, is_active]
        );

        res.status(201).json({ ok: true, line: result.rows[0] });
    } catch (e) {
        // Si tienes una restricción de unicidad y choca, devolver 409
        if (e.code === '23505') {
            return res.status(409).json({ ok: false, error: 'La línea ya existe (violación de unicidad)' });
        }
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;