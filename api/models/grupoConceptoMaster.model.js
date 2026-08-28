import { createModel } from './base.model.js';

export default createModel('grupos_conceptos_master', 'grupo_id', [
  'grupo_id', 'empresa_id', 'nombre', 'descripcion', 'comentario', 'orden', 'permite_importe_fijo', 'es_default_sistema'
]);