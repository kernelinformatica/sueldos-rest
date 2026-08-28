import { createModel } from './base.model.js';

export default createModel('periodos_liquidacion', 'periodo_id', [
  'periodo_id', 'empresa_id', 'anio', 'mes', 'fecha_desde', 'fecha_hasta', 'descripcion', 'estado_id'
]);
