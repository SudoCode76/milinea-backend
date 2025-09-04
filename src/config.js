require('dotenv').config();

const PORT = process.env.PORT || 3000;
const DB_URL = process.env.DB_URL || 'postgres://postgres:postgres@localhost:5432/milinea';
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '';
const GEMINI_KEY = process.env.GEMINI_KEY || '';
const WALK_KMH = parseFloat(process.env.WALK_KMH || '4.8');
const THRESHOLD_M = parseFloat(process.env.THRESHOLD_M || '100');

module.exports = { PORT, DB_URL, MAPBOX_TOKEN, GEMINI_KEY, WALK_KMH, THRESHOLD_M };