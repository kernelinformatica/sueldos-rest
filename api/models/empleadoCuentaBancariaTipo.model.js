import { createModel } from './base.model.js';

export default createModel('empleados_cuentas_bancarias_tipos', 'tipo_cuenta_id', [
  'tipo_cuenta_id', 'empresa_id', 'codigo', 'nombre', 'estado_id'
]);