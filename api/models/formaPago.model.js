import { createModel } from './base.model.js';

export default createModel('formas_pago', 'forma_pago_id', [
  'forma_pago_id', 'empresa_id', 'nombre', 'requiere_banco', 'requiere_cbu', 'requiere_cuenta', 'descripcion', 'estado'
]);