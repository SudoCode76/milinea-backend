const express = require('express');
const cors = require('cors');
const { PORT } = require('./config');

const health = require('./routes/health');
const lines = require('./routes/lines');
const routes = require('./routes/fastest');

const app = express();
app.use(cors());
app.use(express.json());

// Rutas
app.use('/health', health);
app.use('/lines', lines);
app.use('/routes', routes);

// Raíz
app.get('/', (req, res) => res.json({ ok: true, service: 'milinea-backend' }));

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});