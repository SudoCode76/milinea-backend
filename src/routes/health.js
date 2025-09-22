const router = require('express').Router();
const db = require('../db');

router.get('/', async (_req, res) => {
    try {
        // Consulta más simple y compatible
        const { rows } = await db.query(`
      SELECT 
        version() AS pg_version,
        'PostGIS ' || postgis_version() AS postgis_version
    `);
        res.json({
            ok: true,
            pg: rows[0].pg_version,
            postgis: rows[0].postgis_version
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;