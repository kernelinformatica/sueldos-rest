import { createModel } from './base.model.js';

export default createModel('empleados_cuentas_bancarias', 'cuenta_id', [
  'cuenta_id', 'empresa_id', 'empleado_id', 'banco_id', 'tipo_cuenta_id', 'numero_cuenta', 'cbu',
  'alias_cbu', 'titular', 'fecha_desde', 'fecha_hasta', 'principal', 'estado_id'
]);