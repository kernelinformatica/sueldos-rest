import { createModel } from './base.model.js';

export default createModel('liquidaciones', 'liquidacion_id', [
  'liquidacion_id', 'empleado_id', 'empresa_id', 'periodo', 'fecha_liquidacion', 'total', 'forma_pago_id',
  'cbu_pago', 'banco_pago_id', 'estado'
]);
