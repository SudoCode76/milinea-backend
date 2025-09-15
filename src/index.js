const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { PORT } = require('./config');

const health = require('./routes/health');
const lines = require('./routes/lines');
const routes = require('./routes/fastest');
const shapes = require('./routes/shapes');
const directions = require('./routes/directions');
const chat = require('./routes/chat'); // NUEVO

const app = express();
app.use(cors());
app.use(compression()); // NUEVO: gzip/br si está soportado
app.use(express.json({ limit: '2mb' }));

// Rutas
app.use('/health', health);
app.use('/lines', lines);
app.use('/routes', routes);
app.use('/shapes', shapes);
app.use('/directions', directions);
app.use('/chat', chat); // NUEVO

// Raíz
app.get('/', (_req, res) => res.json({ ok: true, service: 'milinea-backend' }));

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});