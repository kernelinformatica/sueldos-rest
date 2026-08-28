import { createModel } from './base.model.js';

export default createModel('liquidaciones_conceptos', 'concepto_liquidacion_id', [
  'concepto_liquidacion_id', 'liquidacion_id', 'concepto_id', 'unidades', 'valor_unitario', 'porcentaje',
  'suma_resta', 'descripcion', 'importe'
]);