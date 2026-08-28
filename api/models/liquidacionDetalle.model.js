import { createModel } from './base.model.js';

export default createModel('liquidaciones_detalle', 'liquidacion_detalle_id', [
  'liquidacion_detalle_id', 'empresa_id', 'liquidacion_id', 'concepto_id', 'codigo_concepto',
  'nombre_concepto', 'cantidad', 'base_calculo', 'porcentaje', 'importe', 'descripcion'
]);