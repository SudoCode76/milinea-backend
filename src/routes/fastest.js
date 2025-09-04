const router = require('express').Router();
const db = require('../db');
const { WALK_KMH, THRESHOLD_M } = require('../config');

router.post('/fastest', async (req, res) => {
    try {
        const { origin, destination, threshold_m, walk_kmh } = req.body || {};
        if (!origin || !destination) {
            return res.status(400).json({
                ok: false,
                error: 'origin and destination required. Format: {origin:{lng,lat}, destination:{lng,lat}}'
            });
        }
        const oLng = Number(origin.lng), oLat = Number(origin.lat);
        const dLng = Number(destination.lng), dLat = Number(destination.lat);
        if ([oLng, oLat, dLng, dLat].some(n => Number.isNaN(n))) {
            return res.status(400).json({ ok: false, error: 'Invalid coordinates' });
        }

        const thr = Number(threshold_m ?? THRESHOLD_M);
        const walk = Number(walk_kmh ?? WALK_KMH);
        const walk_m_per_min = (walk * 1000) / 60.0;

        const sql = `
      WITH
      params AS (
        SELECT
          ST_SetSRID(ST_MakePoint($1, $2), 4326) AS o_geom,
          ST_SetSRID(ST_MakePoint($3, $4), 4326) AS d_geom,
          $5::double precision AS threshold_m,
          $6::double precision AS walk_m_per_min
      ),
      candidates AS (
        SELECT
          ld.id AS line_direction_id,
          l.name AS line_name,
          l.code,
          l.color_hex,
          ld.direction,
          ld.headsign,
          ld.avg_speed_kmh,
          ld.wait_minutes,
          s.id AS shape_id,
          s.seq,
          s.geom
        FROM line_directions ld
        JOIN lines l ON l.id = ld.line_id
        JOIN shapes s ON s.line_direction_id = ld.id
        CROSS JOIN params p
        WHERE l.is_active AND ld.is_active
          AND ST_DWithin(s.geom::geography, p.o_geom::geography, p.threshold_m)
          AND ST_DWithin(s.geom::geography, p.d_geom::geography, p.threshold_m)
      ),
      measures AS (
        SELECT
          c.*,
          ST_LineLocatePoint(c.geom, p.o_geom) AS loc_o,
          ST_LineLocatePoint(c.geom, p.d_geom) AS loc_d,
          ST_ClosestPoint(c.geom, p.o_geom) AS snap_o,
          ST_ClosestPoint(c.geom, p.d_geom) AS snap_d
        FROM candidates c
        CROSS JOIN params p
      ),
      segments AS (
        SELECT
          m.*,
          ST_LineSubstring(m.geom, m.loc_o, m.loc_d) AS seg_geom
        FROM measures m
        WHERE m.loc_o < m.loc_d -- respeta sentido
      ),
      costs AS (
        SELECT
          s.*,
          ST_Length(s.seg_geom::geography) AS ride_m,
          ST_Distance(s.snap_o::geography, p.o_geom::geography) AS walk_to_m,
          ST_Distance(s.snap_d::geography, p.d_geom::geography) AS walk_from_m
        FROM segments s
        CROSS JOIN params p
      ),
      etas AS (
        SELECT
          c.line_direction_id,
          c.shape_id,
          c.seq,
          c.line_name,
          c.code,
          c.color_hex,
          c.direction,
          c.headsign,
          c.avg_speed_kmh,
          c.wait_minutes,
          c.ride_m,
          c.walk_to_m,
          c.walk_from_m,
          (c.walk_to_m / p.walk_m_per_min)
            + (c.ride_m / (c.avg_speed_kmh * 1000.0 / 60.0))
            + (c.walk_from_m / p.walk_m_per_min)
            + c.wait_minutes AS eta_minutes
        FROM costs c
        CROSS JOIN params p
      )
      SELECT *
      FROM etas
      ORDER BY eta_minutes ASC, (walk_to_m + walk_from_m) ASC, ride_m ASC
      LIMIT 5;
    `;

        const { rows } = await db.query(sql, [oLng, oLat, dLng, dLat, thr, walk_m_per_min]);
        res.json({ ok: true, params: { threshold_m: thr, walk_kmh: walk }, results: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;