import { createModel } from './base.model.js';

export default createModel('convenios', 'convenio_id', ['convenio_id', 'empresa_id', 'codigo', 'nombre', 'descripcion', 'estado_id']);
