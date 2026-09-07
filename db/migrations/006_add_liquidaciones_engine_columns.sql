-- Migration: motor de liquidación - desglose de totales y vínculo a período/tipo/estado
ALTER TABLE liquidaciones
  ADD COLUMN periodo_id INT DEFAULT NULL AFTER periodo,
  ADD COLUMN liquidacion_tipo_id INT DEFAULT NULL AFTER periodo_id,
  ADD COLUMN total_haberes DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER total,
  ADD COLUMN total_descuentos DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER total_haberes,
  ADD COLUMN total_neto DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER total_descuentos,
  ADD COLUMN total_contribuciones DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER total_neto,
  ADD COLUMN total_costo_empresa DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER total_contribuciones,
  ADD COLUMN requiere_revision TINYINT(1) NOT NULL DEFAULT 0 AFTER estado,
  ADD COLUMN calculado_en TIMESTAMP NULL DEFAULT NULL AFTER requiere_revision,
  ADD INDEX idx_liquidaciones_periodo_id (periodo_id),
  ADD UNIQUE KEY uk_liquidaciones_empleado_periodo (empresa_id, empleado_id, periodo_id),
  ADD CONSTRAINT FK_liquidaciones_periodos FOREIGN KEY (periodo_id) REFERENCES periodos_liquidacion (periodo_id),
  ADD CONSTRAINT FK_liquidaciones_liquidacion_tipo FOREIGN KEY (liquidacion_tipo_id) REFERENCES liquidacion_tipo (liquidacion_tipo_id);

-- NULL en periodo_id no colisiona con la UNIQUE KEY (InnoDB trata NULL como distinto entre sí),
-- por lo que las filas históricas sin periodo_id siguen existiendo sin conflicto.
