import { createModel } from './base.model.js';

export default createModel('liquidacion_tipo', 'liquidacion_tipo_id', [
  'liquidacion_tipo_id', 'empresa_id', 'nombre', 'descripcion', 'orden', 'estado_id'
]);