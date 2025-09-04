# milinea-backend

Backend Express + PostGIS para MVP de líneas en Cochabamba.

## Variables de entorno

- `PORT` (por defecto 3000)
- `DB_URL` Ej.: `postgres://postgres:TU_PASSWORD@localhost:5432/milinea`
- `MAPBOX_TOKEN` (para geocodificación/tiles desde backend si lo usas)
- `GEMINI_KEY` (reservado para futuros usos)
- `WALK_KMH` (opcional, por defecto 4.8)
- `THRESHOLD_M` (opcional, por defecto 100)

## Arranque

```bash
npm install
cp .env.example .env
npm run dev
```

## Endpoints

- `GET /health` — Estado y versión de PostGIS.
- `GET /lines` — Lista de líneas y sus direcciones.
- `POST /routes/fastest` — Calcula candidatos y ordena por ETA (sin transbordo).

Body ejemplo:
```json
{
  "origin": {"lng": -66.16, "lat": -17.39},
  "destination": {"lng": -66.15, "lat": -17.38},
  "threshold_m": 120,
  "walk_kmh": 4.8
}
```