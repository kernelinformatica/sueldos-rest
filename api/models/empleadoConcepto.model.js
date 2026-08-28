import { createModel } from './base.model.js';

export default createModel('empleados_conceptos', 'empleado_concepto_id', [
  'empleado_concepto_id', 'empresa_id', 'empleado_id', 'concepto_id', 'fecha_asignacion', 'unidades', 'importe',
  'nro_liquidacion', 'operador_codigo', 'operador_control'
]);