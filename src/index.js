const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { PORT } = require('./config');

const health = require('./routes/health');
const lines = require('./routes/lines');
const fastest = require('./routes/fastest');
const lineRoutes = require('./routes/line_routes');
const chat = require('./routes/chat');
const adminUnresolved = require('./routes/admin_unresolved');
const directions = require('./routes/directions'); // <-- NUEVO

const app = express();
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '2mb' }));

app.use('/health', health);
app.use('/lines', lines);
app.use('/routes', fastest);
app.use('/line-routes', lineRoutes);
app.use('/chat', chat);
app.use('/admin', adminUnresolved);
app.use('/directions', directions); // <-- MONTAR

app.get('/', (_req, res) => res.json({ ok: true, service: 'milinea-backend' }));

app.listen(PORT, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});