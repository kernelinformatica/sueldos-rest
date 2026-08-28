import { createModel } from './base.model.js';

export default createModel('empleados_asistencia', 'asistencia_id', [
  'asistencia_id', 'empresa_id', 'empleado_id', 'fecha', 'tipo', 'horas_trabajadas', 'horas_extras_50',
  'horas_extras_100', 'observaciones'
]);