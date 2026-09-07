-- Migration: motor de liquidación - selector de fórmula explícito por concepto
-- Reemplaza el "grupo mágico" del sistema legacy (s_grupo 1..10 hardcodeado en el SP).
-- grupo_id sigue existiendo y se sigue usando para organización/topes/base de sumas de grupo;
-- formula_tipo indica, de forma explícita y autodescriptiva, QUÉ fórmula aplicar.
ALTER TABLE conceptos
  ADD COLUMN formula_tipo ENUM(
    'FIJO',
    'BASICO',
    'PRESENTISMO',
    'PORCENTAJE_REMUNERATIVO',
    'PORCENTAJE_CATEGORIA',
    'SUMA_GRUPO',
    'ANTIGUEDAD',
    'HORAS_EXTRA_50',
    'HORAS_EXTRA_100',
    'SAC',
    'MANUAL'
  ) NOT NULL DEFAULT 'MANUAL' AFTER es_sueldo_basico,
  ADD INDEX idx_conceptos_formula_tipo (formula_tipo);

-- Backfill de los conceptos ya cargados. Se usa `codigo` (nomenclatura AFIP/convenio,
-- estable entre empresas) en vez de concepto_id para que aplique a cualquier tenant.
UPDATE conceptos SET formula_tipo = 'BASICO' WHERE es_sueldo_basico = 1;
UPDATE conceptos SET formula_tipo = 'FIJO' WHERE es_sueldo_basico = 0 AND codigo IN ('12', '98', '110', '930');
UPDATE conceptos SET formula_tipo = 'PRESENTISMO' WHERE es_sueldo_basico = 0 AND codigo = '19';
UPDATE conceptos SET formula_tipo = 'ANTIGUEDAD' WHERE es_sueldo_basico = 0 AND codigo = '14';
UPDATE conceptos SET formula_tipo = 'SAC' WHERE es_sueldo_basico = 0 AND codigo = '16';
UPDATE conceptos SET formula_tipo = 'PORCENTAJE_REMUNERATIVO'
  WHERE es_sueldo_basico = 0 AND codigo IN ('722', '702', '704', '705', '711', '723', '904', '931', '933', '701');
