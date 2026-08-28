import { createModel } from './base.model.js';

export default createModel('parametros_liquidacion', 'parametro_id', [
  'parametro_id', 'empresa_id', 'codigo', 'nombre', 'descripcion', 'tipo_dato', 'valor', 'fecha_desde',
  'fecha_hasta', 'estado_id'
]);