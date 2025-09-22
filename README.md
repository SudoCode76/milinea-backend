# Mi Línea Backend 🚌

API REST para el sistema de transporte urbano "Mi Línea" en La Paz, Bolivia. Permite gestionar líneas de transporte público y calcular rutas optimizadas con inteligencia artificial.

## 🚀 Características

- ✅ Gestión de líneas de transporte público
- ✅ Rutas geográficas por sentido (ida/vuelta)
- ✅ Cálculo de rutas más rápidas con PostGIS
- ✅ Chat inteligente con integración Gemini AI
- ✅ Geocodificación con Mapbox
- ✅ Base de datos PostgreSQL + PostGIS

## 📦 Descarga e Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/SudoCode76/milinea-backend.git
cd milinea-backend
```

### 2. Instalar dependencias
```bash
npm install
```
### 3. Iniciar servidor
```bash
npm run dev
```

## 🧪 Ejemplo de uso en Postman

A continuación se muestra cómo realizar las operaciones principales usando Postman:

### 1. Agregar una línea

**Endpoint:** `POST http://localhost:3000/lines`

**Body (JSON):**
```json
{
  "code": "20",
  "name": "20",
  "color_hex": "#B727F5"
}
```

**Respuesta esperada:**
```json
{
  "ok": true,
  "line": {
    "id": "1",
    "code": "20",
    "name": "20",
    "color_hex": "#B727F5",
    "is_active": true,
    "created_at": "2025-09-22T12:16:42.576Z",
    "updated_at": "2025-09-22T12:16:42.576Z"
  }
}
```

---

### 2. Agregar ruta de ida

**Endpoint:** `POST http://localhost:3000/line-routes`

**Body (JSON):**
```json
{
  "line_id": 1,
  "direction": "outbound",
  "featureCollection": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "properties": {},
        "geometry": {
          "type": "LineString",
          "coordinates": [
            [ -66.149227, -17.394477 ],
            [ -66.149999, -17.390769 ],
            [ -66.157989, -17.392381 ],
            [ -66.158833, -17.392542 ],
            [ -66.157964, -17.397702 ]
          ]
        },
        "id": "ruta-ida"
      }
    ]
  }
}
```

**Respuesta esperada:**
```json
{
  "ok": true,
  "route": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "id": "1",
        "properties": {},
        "geometry": {
          "type": "LineString",
          "coordinates": [
            [ -66.149227, -17.394477 ],
            [ -66.149999, -17.390769 ],
            [ -66.157989, -17.392381 ],
            [ -66.158833, -17.392542 ],
            [ -66.157964, -17.397702 ]
          ]
        }
      }
    ]
  },
  "meta": {
    "line_id": "1",
    "direction": "outbound",
    "length_m": 1956
  }
}
```

---

### 3. Agregar ruta de vuelta

**Endpoint:** `POST http://localhost:3000/line-routes`

**Body (JSON):**
```json
{
  "line_id": 1,
  "direction": "inbound",
  "featureCollection": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "properties": {},
        "geometry": {
          "type": "LineString",
          "coordinates": [
            [ -66.157681, -17.39936 ],
            [ -66.156435, -17.399527 ],
            [ -66.152235, -17.398504 ],
            [ -66.150638, -17.398525 ],
            [ -66.148319, -17.398379 ],
            [ -66.144535, -17.396709 ],
            [ -66.142457, -17.394851 ],
            [ -66.141844, -17.393912 ],
            [ -66.142522, -17.392263 ],
            [ -66.142894, -17.391595 ]
          ]
        },
        "id": "ruta-vuelta"
      }
    ]
  }
}
```

**Respuesta esperada:**
```json
{
  "ok": true,
  "route": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "id": "2",
        "properties": {},
        "geometry": {
          "type": "LineString",
          "coordinates": [
            [ -66.157681, -17.39936 ],
            [ -66.156435, -17.399527 ],
            [ -66.152235, -17.398504 ],
            [ -66.150638, -17.398525 ],
            [ -66.148319, -17.398379 ],
            [ -66.144535, -17.396709 ],
            [ -66.142457, -17.394851 ],
            [ -66.141844, -17.393912 ],
            [ -66.142522, -17.392263 ],
            [ -66.142894, -17.391595 ]
          ]
        }
      }
    ]
  },
  "meta": {
    "line_id": "1",
    "direction": "inbound",
    "length_m": 2158
  }
}
```

---

Puedes copiar estos ejemplos en Postman, seleccionando el método POST, el endpoint correspondiente y el cuerpo en formato raw (JSON).
