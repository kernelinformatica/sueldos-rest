-- Migration: motor de liquidación - modo de pago del básico según tipo de contratación
-- Evita inferir por texto ("parcial"/"jornal") en tiempo de cálculo: queda como dato estructurado.
ALTER TABLE contrataciones_tipos
  ADD COLUMN modo_pago ENUM('MENSUAL', 'PRORRATEADO', 'DIARIO') NOT NULL DEFAULT 'MENSUAL' AFTER descripcion;

-- Backfill best-effort por nombre para los tipos ya cargados (ajustable luego desde el catálogo)
UPDATE contrataciones_tipos SET modo_pago = 'PRORRATEADO' WHERE LOWER(nombre) LIKE '%parcial%';
UPDATE contrataciones_tipos SET modo_pago = 'DIARIO'
  WHERE LOWER(nombre) LIKE '%jornal%' OR LOWER(nombre) LIKE '%agrario%' OR LOWER(nombre) LIKE '%rural%';
