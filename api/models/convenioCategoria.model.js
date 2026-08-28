import { createModel } from './base.model.js';

export default createModel('convenios_categorias', 'categoria_id', [
  'categoria_id', 'empresa_id', 'convenio_id', 'codigo', 'nombre', 'descripcion', 'sueldo_basico',
  'valor_hora', 'valor_dia', 'estado_id'
]);