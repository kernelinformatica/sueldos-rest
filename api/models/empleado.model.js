import { createModel } from './base.model.js';

export default createModel('empleados', 'empleado_id', [
  'empleado_id', 'empresa_id', 'sucursal_id', 'seccion_id', 'cargo_id', 'legajo', 'tipo_documento',
  'numero_documento', 'nombre', 'apellido', 'fecha_nacimiento', 'sexo', 'estado_civil', 'nacionalidad',
  'direccion', 'localidad', 'telefono', 'email', 'fecha_ingreso', 'fecha_egreso',
  'tipo_contratacion_id', 'convenio_categoria_id', 'dias_trabajados', 'forma_pago_id', 'obra_social_id', 'foto', 'estado'
]);
