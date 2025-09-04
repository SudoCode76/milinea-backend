const router = require('express').Router();
const db = require('../db');

router.get('/', async (_req, res) => {
    try {
        const { rows } = await db.query('SELECT version() AS pg, postgis_full_version() AS postgis');
        res.json({ ok: true, pg: rows[0].pg, postgis: rows[0].postgis });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;