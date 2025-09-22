const router = require('express').Router();
const db = require('../db');

// GET /lines -> solo catálogo de líneas (sin extras por dirección)
router.get('/', async (_req, res) => {
    try {
        const { rows } = await db.query(`
      SELECT id AS line_id, code, name, color_hex, is_active, created_at, updated_at
      FROM lines
      ORDER BY name ASC, code ASC
    `);
        res.json({ ok: true, data: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /lines -> crea línea
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
        if (e.code === '23505') {
            return res.status(409).json({ ok: false, error: 'La línea ya existe (violación de unicidad)' });
        }
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /lines/:id/routes -> ambas rutas como FC (o null)
router.get('/:id/routes', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'id inválido' });

        const { rows: lineRows } = await db.query(`SELECT id AS line_id, code, name, color_hex FROM lines WHERE id=$1`, [id]);
        if (lineRows.length === 0) return res.status(404).json({ ok: false, error: 'line not found' });
        const line = lineRows[0];

        const { rows } = await db.query(
            `SELECT id, direction, ST_AsGeoJSON(geom)::json AS geom
       FROM line_routes
       WHERE line_id=$1`,
            [id]
        );

        const toFC = (id, geom) => ({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                id,
                properties: {},
                geometry: geom
            }]
        });

        const outbound = rows.find(r => r.direction === 'outbound');
        const inbound = rows.find(r => r.direction === 'inbound');

        res.json({
            ok: true,
            line,
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