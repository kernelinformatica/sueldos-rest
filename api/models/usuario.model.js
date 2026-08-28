import { createModel } from './base.model.js';

export default createModel('usuarios', 'usuario_id', [
  'usuario_id', 'empresa_id', 'rol_id', 'username', 'email', 'password_hash', 'nombre', 'apellido',
  'ultimo_acceso', 'ultimo_ip', 'intentos_fallidos', 'bloqueado_hasta', 'password_fecha_cambio',
  'created_at', 'updated_at', 'estado_id'
]);
