import { createModel } from './base.model.js';

export default createModel('novedades', 'novedad_id', [
  'novedad_id', 'periodo_id', 'empleado_id', 'concepto_id', 'fecha', 'cantidad', 'importe', 'porcentaje',
  'observaciones', 'estado_id', 'operador_codigo', 'fecha_carga'
]);