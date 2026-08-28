import { createModel } from './base.model.js';

export default createModel('lsd_seg_social_vigencias', 'vigencia_id', [
  'vigencia_id', 'empresa_id', 'subsistema_id', 'fecha_desde', 'fecha_hasta', 'porcentaje_aporte',
  'porcentaje_contribucion', 'importe_fijo_aporte', 'importe_fijo_contribucion', 'estado_id'
]);