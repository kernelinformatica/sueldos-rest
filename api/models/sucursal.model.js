import { createModel } from './base.model.js';

export default createModel('sucursales', 'sucursal_id', [
  'sucursal_id', 'cod_interno', 'empresa_id', 'nombre', 'direccion', 'principal', 'estado', 'orden'
]);