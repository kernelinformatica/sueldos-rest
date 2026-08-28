import { createModel } from './base.model.js';

export default createModel('conceptos', 'concepto_id', [
  'concepto_id', 'empresa_id', 'grupo_id', 'tipo_concepto_id', 'codigo', 'descripcion', 'importe_fijo',
  'multiplicador', 'divisor', 'suma_resta', 'afecta_sac', 'detalle', 'es_sueldo_basico', 'sueldo_basico_key'
]);
