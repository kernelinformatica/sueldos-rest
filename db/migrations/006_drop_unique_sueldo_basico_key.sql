-- Permite que existan multiples conceptos marcados como sueldo basico por empresa.
-- El constraint unico anterior forzaba un solo concepto con sueldo_basico_key = 1.
ALTER TABLE conceptos
  DROP INDEX ux_conceptos_sueldo_basico_por_empresa,
  ADD INDEX idx_conceptos_sueldo_basico_key (sueldo_basico_key);
