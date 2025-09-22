-- Ejecutar como superusuario postgres
DROP DATABASE IF EXISTS milinea;
CREATE DATABASE milinea;


BEGIN;

-- PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enum
CREATE TYPE direction_enum AS ENUM ('outbound', 'inbound');

-- Función trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END$$;

-- Tabla lines
CREATE TABLE lines (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  color_hex  TEXT        NOT NULL CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_lines_code_name UNIQUE (code, name)
);

CREATE TRIGGER trg_lines_updated_at
  BEFORE UPDATE ON lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tabla line_routes
CREATE TABLE line_routes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  line_id    BIGINT          NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  direction  direction_enum  NOT NULL,
  geom       geometry(LineString, 4326) NOT NULL,
  length_m   DOUBLE PRECISION GENERATED ALWAYS AS (ST_Length(geom::geography)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_line_routes UNIQUE (line_id, direction)
);

CREATE TRIGGER trg_line_routes_updated_at
  BEFORE UPDATE ON line_routes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_line_routes_geom_gist ON line_routes USING GIST (geom);
CREATE INDEX idx_line_routes_line_dir ON line_routes (line_id, direction);

COMMIT;

-- Verificar
SELECT 'Tables created:' AS status;
\dt
SELECT 'PostGIS installed:' AS status;
SELECT postgis_version();