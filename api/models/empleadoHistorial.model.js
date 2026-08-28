import { createModel } from './base.model.js';

export default createModel('empleados_historial', 'historial_id', [
  'historial_id', 'empleado_id', 'convenio_id', 'categoria_id', 'sucursal_id', 'seccion_id', 'cargo_id',
  'tipo_contratacion_id', 'fecha_desde', 'fecha_hasta', 'observaciones'
]);