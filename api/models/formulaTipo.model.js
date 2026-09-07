import { createModel } from './base.model.js';

export default createModel('formula_tipos', 'formula_tipo_id', [
  'formula_tipo_id', 'empresa_id', 'codigo', 'nombre', 'descripcion', 'activo', 'orden', 'creado_en', 'actualizado_en'
]);