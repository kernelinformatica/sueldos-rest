import { createModel } from './base.model.js';

export default createModel('contrataciones_tipos', 'contrataciones_tipos_id', [
  'contrataciones_tipos_id', 'empresa_id', 'nombre', 'descripcion', 'estado'
]);