BEGIN;

-- Asegura PostGIS habilitado (si ya está, no hace nada)
CREATE EXTENSION IF NOT EXISTS postgis;

-- (Opcional) usa el esquema public explícitamente
SET search_path = public;

-- Tipo enumerado para el sentido de la línea (ida/vuelta)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'direction_enum') THEN
CREATE TYPE direction_enum AS ENUM ('outbound', 'inbound'); -- outbound = ida, inbound = vuelta
END IF;
END$$;

-- Función/trigger para updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
RETURN NEW;
END$$;

-- Tabla principal de líneas (ej.: "L134 Amarillo", "L134 Verde")
CREATE TABLE IF NOT EXISTS lines (
                                     id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                                     code        TEXT        NOT NULL,                         -- ej. "134"
                                     name        TEXT        NOT NULL,                         -- ej. "L134 Amarillo"
                                     color_hex   TEXT        NOT NULL CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_lines_code_name UNIQUE (code, name)
    );
DROP TRIGGER IF EXISTS trg_lines_updated_at ON lines;
CREATE TRIGGER trg_lines_updated_at
    BEFORE UPDATE ON lines
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE lines IS 'Catálogo de líneas (concepto).';
COMMENT ON COLUMN lines.code IS 'Código corto de la línea (ej. "134").';
COMMENT ON COLUMN lines.name IS 'Nombre visible (ej. "L134 Amarillo").';
COMMENT ON COLUMN lines.color_hex IS 'Color HEX para dibujar la línea.';

-- Tabla de direcciones por línea (ida/vuelta) y parámetros de ETA
CREATE TABLE IF NOT EXISTS line_directions (
                                               id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                                               line_id        BIGINT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
    direction      direction_enum NOT NULL,                     -- outbound/inbound
    headsign       TEXT        NOT NULL,                        -- ej. "Oeste → Centro"
    avg_speed_kmh  NUMERIC(5,2) NOT NULL DEFAULT 20.00 CHECK (avg_speed_kmh > 0 AND avg_speed_kmh <= 200),
    wait_minutes   INTEGER      NOT NULL DEFAULT 5 CHECK (wait_minutes >= 0 AND wait_minutes <= 120),
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_line_direction UNIQUE (line_id, direction)
    );
DROP TRIGGER IF EXISTS trg_line_directions_updated_at ON line_directions;
CREATE TRIGGER trg_line_directions_updated_at
    BEFORE UPDATE ON line_directions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE line_directions IS 'Par de direcciones por línea con parámetros para ETA.';
COMMENT ON COLUMN line_directions.direction IS 'outbound = ida, inbound = vuelta.';
COMMENT ON COLUMN line_directions.headsign IS 'Texto del sentido mostrado al usuario.';

-- Trazados (polilíneas) por dirección
-- Puedes usar 1 fila por dirección (seq=1) o varios tramos ordenados.
CREATE TABLE IF NOT EXISTS shapes (
                                      id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                                      line_direction_id  BIGINT NOT NULL REFERENCES line_directions(id) ON DELETE CASCADE,
    seq                INTEGER NOT NULL DEFAULT 1 CHECK (seq >= 1),
    geom               geometry(LineString, 4326) NOT NULL,
    -- Longitud en metros (calculada a partir de la geometría)
    length_m           DOUBLE PRECISION GENERATED ALWAYS AS (ST_Length(geom::geography)) STORED,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shapes_dir_seq UNIQUE (line_direction_id, seq)
    );
DROP TRIGGER IF EXISTS trg_shapes_updated_at ON shapes;
CREATE TRIGGER trg_shapes_updated_at
    BEFORE UPDATE ON shapes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE shapes IS 'Trazados por dirección. Usado para proximidad, sentido y dibujo.';
COMMENT ON COLUMN shapes.seq IS 'Orden del tramo dentro de la dirección (1..N).';

-- Índices recomendados
CREATE INDEX IF NOT EXISTS idx_shapes_geom_gist ON shapes USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_shapes_line_dir_seq ON shapes (line_direction_id, seq);

-- Semillas mínimas para tu MVP (sin shapes aún)
-- Líneas: L134 Amarillo y L134 Verde
INSERT INTO lines (code, name, color_hex)
VALUES
    ('134', 'L134 Amarillo', '#FFC107'),
    ('134', 'L134 Verde',    '#2ECC71')
    ON CONFLICT (code, name) DO NOTHING;

-- Direcciones (con velocidades/espera iniciales)
-- Amarillo: 20 km/h, Verde: 18 km/h, espera fija 5 min
INSERT INTO line_directions (line_id, direction, headsign, avg_speed_kmh, wait_minutes)
SELECT l.id, d.direction, d.headsign, d.avg_speed_kmh, d.wait_minutes
FROM (
         VALUES
             ('L134 Amarillo','outbound'::direction_enum,'Oeste → Centro', 20.0, 5),
             ('L134 Amarillo','inbound'::direction_enum,'Centro → Oeste',  20.0, 5),
             ('L134 Verde',   'outbound'::direction_enum,'Este → Centro',  18.0, 5),
             ('L134 Verde',   'inbound'::direction_enum,'Centro → Este',   18.0, 5)
     ) AS d(line_name, direction, headsign, avg_speed_kmh, wait_minutes)
         JOIN lines l ON l.name = d.line_name
    ON CONFLICT (line_id, direction) DO NOTHING;

COMMIT;

-- --- PRUEBAS RÁPIDAS (ejecutar por separado si quieres) ---
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;
-- SELECT * FROM lines;
-- SELECT l.name, ld.direction, ld.headsign FROM line_directions ld JOIN lines l ON l.id=ld.line_id ORDER BY l.name, ld.direction;

-- --- EJEMPLO OPCIONAL: insertar polilíneas de ambos sentidos (reemplaza coords) ---
/*
INSERT INTO shapes (line_direction_id, seq, geom)
VALUES
  (
    (SELECT ld.id FROM line_directions ld JOIN lines l ON l.id=ld.line_id
     WHERE l.name='L134 Amarillo' AND ld.direction='outbound'), 1,
    ST_GeomFromText('LINESTRING(-66.1900 -17.4100,-66.1750 -17.4050,-66.1600 -17.3950,-66.1500 -17.3900)',4326)
  ),
  (
    (SELECT ld.id FROM line_directions ld JOIN lines l ON l.id=ld.line_id
     WHERE l.name='L134 Amarillo' AND ld.direction='inbound'), 1,
    ST_GeomFromText('LINESTRING(-66.1500 -17.3900,-66.1600 -17.3950,-66.1750 -17.4050,-66.1900 -17.4100)',4326)
  );
*/


SELECT * FROM lines;
SELECT l.name, ld.direction FROM line_directions ld JOIN lines l ON l.id=ld.line_id;
SELECT * FROM shapes;
