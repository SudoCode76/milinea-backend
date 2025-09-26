const router = require('express').Router();
const db = require('../db');

// (ANTERIOR) GET /lines simple (lo conservamos por compatibilidad)
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

/**
 * GET /lines/directions?q=texto
 * Devuelve una fila por cada dirección (outbound / inbound) activa.
 * Si q se define, filtra por code, nombre de línea o headsign (Ida / Vuelta)
 * y además permite coincidencias parciales (ILIKE).
 */
router.get('/directions', async (req, res) => {
    try {
        const qRaw = (req.query.q || '').toString().trim();
        const hasQ = qRaw.length > 0;

        // Usamos un parámetro sólo si hay búsqueda
        // headsign se deriva del direction
        let sql = `
      SELECT
        lr.id AS line_direction_id,
        l.id AS line_id,
        l.code,
        l.name AS line_name,
        l.color_hex,
        lr.direction,
        CASE WHEN lr.direction='outbound' THEN 'Ida' ELSE 'Vuelta' END AS headsign
      FROM lines l
      JOIN line_routes lr ON lr.line_id = l.id
      WHERE l.is_active
    `;

        const params = [];
        if (hasQ) {
            params.push(`%${qRaw}%`);
            sql += `
        AND (
          l.code ILIKE $1
          OR l.name ILIKE $1
          OR (CASE WHEN lr.direction='outbound' THEN 'Ida' ELSE 'Vuelta' END) ILIKE $1
        )
      `;
        }

        sql += ` ORDER BY l.name ASC, l.code ASC, lr.direction ASC`;

        const { rows } = await db.query(sql, params);
        res.json({ ok: true, query: qRaw, data: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// POST /lines (igual que antes)
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

// GET /lines/:id/routes (igual)
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