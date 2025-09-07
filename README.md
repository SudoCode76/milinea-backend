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
- `POST /shapes` — Crear/actualizar shape por dirección (acepta array de coords).
- `GET /shapes/:line_direction_id` — Lista shapes de esa dirección (GeoJSON incluido).
- `POST /routes/fastest` — Calcula candidatos y ordena por ETA (sin transbordo).
- `GET /directions/:id/route` — Devuelve la geometría unificada (LineString/MultiLineString) de una dirección para dibujar en una sola llamada.

### Ejemplo `GET /directions/:id/route`

Respuesta:
```json
{
  "ok": true,
  "direction": {
    "id": 1,
    "line_id": 10,
    "line_name": "L134 Amarillo",
    "code": "134",
    "color_hex": "#FFC107",
    "direction": "outbound",
    "headsign": "Oeste → Centro"
  },
  "segments": 1,
  "length_m_total": 5230,
  "geometry": {
    "type": "LineString",
    "coordinates": [[-66.19,-17.41],[-66.175,-17.405],[-66.16,-17.395],[-66.15,-17.39]]
  }
}
```

Notas:
- `geometry` puede ser `MultiLineString` si los tramos no son contiguos, o `LineString` si se pueden fusionar.
- Si no hay shapes aún para esa dirección, `geometry` será `null`, `segments` será `0`.