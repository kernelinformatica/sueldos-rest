-- Migration: motor de liquidación - trazabilidad de fórmula y topes por línea de detalle
ALTER TABLE liquidaciones_detalle
  ADD COLUMN formula_tipo VARCHAR(30) DEFAULT NULL AFTER concepto_id,
  ADD COLUMN suma_resta ENUM('S','R') DEFAULT NULL AFTER formula_tipo,
  ADD COLUMN tope_aplicado_id INT DEFAULT NULL AFTER importe,
  ADD COLUMN importe_original DECIMAL(14,2) DEFAULT NULL AFTER tope_aplicado_id,
  ADD COLUMN requiere_revision TINYINT(1) NOT NULL DEFAULT 0 AFTER importe_original,
  ADD COLUMN advertencia VARCHAR(255) DEFAULT NULL AFTER requiere_revision,
  ADD CONSTRAINT FK_liquidaciones_detalle_topes FOREIGN KEY (tope_aplicado_id) REFERENCES conceptos_topes (tope_id);
