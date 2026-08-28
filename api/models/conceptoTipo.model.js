import { createModel } from './base.model.js';

export default createModel('conceptos_tipos', 'conceptos_tipos_id', [
  'conceptos_tipos_id', 'empresa_id', 'codigo', 'nombre', 'descripcion', 'prioridad'
]);