import { createModel } from './base.model.js';

export default createModel('conceptos_topes', 'tope_id', [
  'tope_id', 'empresa_id', 'concepto_id', 'grupo_id', 'activo', 'accion', 'tipo', 'unidad', 'valor', 'requiere_override', 'fecha_desde', 'fecha_hasta', 'descripcion', 'created_at', 'updated_at'
]);
