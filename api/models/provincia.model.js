import { createModel } from './base.model.js';

// Nueva tabla `provincia` en la base de datos.
// Mapeamos el modelo a la nueva tabla. Campos originales del API se mantienen vía alias en rutas.
export default createModel('provincia', 'id', [
  'id', 'codigoIndec', 'nombre', 'codigoPais'
]);