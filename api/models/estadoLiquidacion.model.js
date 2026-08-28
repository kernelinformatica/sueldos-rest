import { createModel } from './base.model.js';

export default createModel('estados_liquidaciones', 'estado_liquidacion_id', [
  'estado_liquidacion_id', 'nombre', 'descripcion', 'es_activo'
]);