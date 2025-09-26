const router = require('express').Router();
const { listUnresolved } = require('../services/unresolved_terms');

// (Opcional) Middleware de auth básico
// router.use((req,res,next)=>{
//   const token = req.headers['x-admin-token'];
//   if (token !== process.env.ADMIN_TOKEN) return res.status(403).json({ok:false,error:'forbidden'});
//   next();
// });

router.get('/unresolved', (req, res) => {
    const min = Number(req.query.min_hits) || 2;
    const data = listUnresolved({ minHits: min });
    res.json({ ok: true, min_hits: min, count: data.length, data });
});

module.exports = router;