-- Migration: add permite_importe_fijo to grupos_conceptos_master
-- Default: 0 (no permite importe fijo por defecto)

ALTER TABLE grupos_conceptos_master
  ADD COLUMN permite_importe_fijo TINYINT(1) NOT NULL DEFAULT 0 AFTER comentario,
  ADD INDEX idx_grupo_permite_importe_fijo (permite_importe_fijo);

-- OPTIONAL: copiar política desde conceptos_tipos_via_conceptos a cada grupo
-- Esta consulta toma el mínimo (si alguna regla en el grupo no permite, prevalece 0)
-- Descomentar y ejecutar si querés poblar inicialmente según tipos actuales.
-- UPDATE grupos_conceptos_master g
-- JOIN (
--   SELECT c.grupo_id, MIN(COALESCE(ct.permite_importe_fijo, 1)) AS permite
--   FROM conceptos c
--   LEFT JOIN conceptos_tipos ct ON ct.conceptos_tipos_id = c.tipo_concepto_id
--   GROUP BY c.grupo_id
-- ) t ON t.grupo_id = g.grupo_id
-- SET g.permite_importe_fijo = t.permite;
