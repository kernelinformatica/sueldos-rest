import { createModel } from './base.model.js';

export default createModel('cargos', 'cargo_id', [
  'cargo_id', 'empresa_id', 'seccion_id', 'nombre', 'abreviatura', 'responsable', 'descripcion', 'estado_id'
]);
