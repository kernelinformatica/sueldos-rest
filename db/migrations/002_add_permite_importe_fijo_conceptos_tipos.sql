-- Migration: Add permite_importe_fijo to conceptos_tipos
-- Fecha: 2026-08-21

ALTER TABLE conceptos_tipos
  ADD COLUMN permite_importe_fijo TINYINT(1) NOT NULL DEFAULT 1 AFTER descripcion;

-- Nota: ejecutá esta migración en la DB de cada empresa/entorno.
