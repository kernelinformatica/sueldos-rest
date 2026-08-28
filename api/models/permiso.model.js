import { createModel } from './base.model.js';

export default createModel('permiso', 'id', [
  'id', 'empresa_id', 'nombre', 'descripcion', 'alias', 'modulo', 'grupo', 'icono', 'router', 'esMenu', 'estado'
]);
