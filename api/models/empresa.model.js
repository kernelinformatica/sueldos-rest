import { createModel } from './base.model.js';

export default createModel('empresas', 'empresa_id', [
  'empresa_id', 'codigo', 'nombre', 'nombre_fantasia', 'cuit', 'condicion_iva_id',
  'tipo_sociedad_id', 'inicio_actividades', 'ingresos_brutos', 'direccion', 'localidad',
  'provincia_id', 'codigo_postal', 'pais_id', 'telefono', 'celular', 'email', 'web', 'logo',
  'leyenda_recibo', 'forma_pago_id', 'estado_id', 'created_at', 'updated_at'
]);
