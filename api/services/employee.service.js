import pool from '../db.js';
import { sendError } from '../utils/response.util.js';

async function exists(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows.length > 0;
}

function nullIfEmpty(value) {
  return value === '' ? null : value;
}

function normalizeEstadoCivil(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();
  const map = {
    'SOLTERO/A': 'SOLTERO',
    'SOLTERO': 'SOLTERO',
    'CASADO/A': 'CASADO',
    'CASADO': 'CASADO',
    'DIVORCIADO/A': 'DIVORCIADO',
    'DIVORCIADO': 'DIVORCIADO',
    'VIUDO/A': 'VIUDO',
    'VIUDO': 'VIUDO',
    'SEPARADO/A': 'SEPARADO',
    'SEPARADO': 'SEPARADO',
    'UNION CONVIVENCIAL': 'UNION CONVIVENCIAL',
    'UNIÓN CONVIVENCIAL': 'UNION CONVIVENCIAL',
  };

  return map[normalized] ?? String(value).trim();
}

function resolveEmployeeState(payload, fallbackState) {
  // Do not treat `habilitado` as an Estado value. `habilitado` is stored
  // in its own column. Resolve `estado` only from payload.estado or fallback.
  if (payload && typeof payload === 'object') {
    if (payload.estado && typeof payload.estado === 'object') {
      if (payload.estado.estado_id !== undefined && payload.estado.estado_id !== null && payload.estado.estado_id !== '') {
        return payload.estado.estado_id;
      }
    }

    if (payload.estado !== undefined && payload.estado !== null && payload.estado !== '') {
      return payload.estado;
    }
  }

  return fallbackState ?? 1;
}

function mapEmployeeRow(row) {
  if (!row) return row;

  return {
    empleado_id: row.empleado_id,
    empresa_id: row.empresa_id,
    sucursal_id: row.sucursal_id,
    seccion_id: row.seccion_id,
    cargo_id: row.cargo_id,
    legajo: row.legajo,
    tipo_documento: row.tipo_documento,
    numero_documento: row.numero_documento,
    nombre: row.nombre,
    apellido: row.apellido,
    fecha_nacimiento: row.fecha_nacimiento,
    sexo: row.sexo,
    estado_civil: row.estado_civil,
    nacionalidad: row.nacionalidad,
    direccion: row.direccion,
    localidad: row.localidad,
    // provincia now derives from localidad; remove provincia from empleado
    telefono: row.telefono,
    email: row.email,
    fecha_ingreso: row.fecha_ingreso,
    fecha_egreso: row.fecha_egreso,
    tipo_contratacion_id: row.tipo_contratacion_id,
    contratacion_tipo_id: row.tipo_contratacion_id,
    convenio_categoria_id: row.convenio_categoria_id,
    dias_trabajados: row.dias_trabajados,
    forma_pago_id: row.forma_pago_id,
    foto: row.foto,
    habilitado: row.habilitado,
    estado: mapEmployeeState(row),
    empresa: {
      empresa_id: row.empresa_id_ref,
      nombre: row.empresa_nombre,
      nombre_fantasia: row.empresa_nombre_fantasia,
      cuit: row.empresa_cuit,
    },
    cargo: row.cargo_id_ref ? {
      cargo_id: row.cargo_id_ref,
      nombre: row.cargo_nombre,
      descripcion: row.cargo_descripcion,
    } : null,
    seccion: row.seccion_id_ref ? {
      seccion_id: row.seccion_id_ref,
      nombre: row.seccion_nombre,
      orden: row.seccion_orden,
      estado: row.seccion_estado,
    } : null,
    sucursal: row.sucursal_id_ref ? {
      sucursal_id: row.sucursal_id_ref,
      nombre: row.sucursal_nombre,
    } : null,
    contratacion_tipo: row.contratacion_tipo_id_ref ? {
      contrataciones_tipos_id: row.contratacion_tipo_id_ref,
      contratacion_tipo_id: row.contratacion_tipo_id_ref,
      nombre: row.contratacion_nombre,
    } : null,
    convenio_categoria: row.categoria_id_ref ? {
      categoria_id: row.categoria_id_ref,
      convenio_categoria_id: row.categoria_id_ref,
      nombre: row.categoria_nombre,
    } : null,
    convenio: row.convenio_id_ref ? {
      convenio_id: row.convenio_id_ref,
      nombre: row.convenio_nombre,
    } : null,
    forma_pago: row.forma_pago_id_ref ? {
      forma_pago_id: row.forma_pago_id_ref,
      nombre: row.forma_pago_nombre,
      descripcion: row.forma_pago_descripcion,
    } : null,
    cuenta_bancaria_principal: row.cuenta_bancaria_id ? {
      cuenta_id: row.cuenta_bancaria_id,
      banco_id: row.banco_id_ref,
      tipo_cuenta_id: row.tipo_cuenta_id_ref,
      numero_cuenta: row.numero_cuenta,
      cbu: row.cbu,
      alias_cbu: row.alias_cbu,
      titular: row.titular,
      fecha_desde: row.fecha_desde,
      fecha_hasta: row.fecha_hasta,
      principal: row.cuenta_principal,
      banco: row.banco_id_ref_banco ? {
        banco_id: row.banco_id_ref_banco,
        nombre: row.banco_nombre,
      } : null,
    } : null,
    sueldo_actual: row.sueldo_actual ?? null,
  };
}

function mapEmployeeFileRow(row) {
  return {
    archivo_id: row.archivo_id,
    empresa_id: row.empresa_id,
    empleado_id: row.empleado_id,
    tipo: row.tipo,
    alias: row.alias,
    nombre_archivo: row.nombre_archivo,
    ruta_archivo: row.ruta_archivo,
    ruta_publica: row.ruta_publica,
    url_publica: row.url_publica,
    mime_type: row.mime_type,
    extension: row.extension,
    tamano_bytes: row.tamano_bytes,
    es_principal: row.es_principal,
    descripcion: row.descripcion,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function attachArchivos(rows, archivosByEmpleadoId) {
  return rows.map((row) => {
    const empleado = mapEmployeeRow(row);
    empleado.archivos = archivosByEmpleadoId.get(String(row.empleado_id)) ?? [];
    // sueldo_actual será adjuntado externamente por la consulta de salarios
    // conceptos asignados (si fueron consultados) se adjuntan aquí
    empleado.conceptos = row.conceptos || [];
    return empleado;
  });
}

function mapEmployeeState(row) {
  if (!row || row.estado_id_ref === null || row.estado_id_ref === undefined) {
    return {
      estado_id: row?.estado ?? null,
      nombre: null,
      descripcion: null,
      es_activo: null,
    };
  }

  return {
    estado_id: row.estado_id_ref,
    nombre: row.estado_nombre,
    descripcion: row.estado_descripcion,
    es_activo: row.estado_es_activo,
  };
}

function formatDbError(err) {
  if (!err) return { status: 500, message: 'Error de base de datos' };

  // Foreign key constraint (Cannot add or update a child row...)
  if (err.errno === 1452 || err.code === 'ER_NO_REFERENCED_ROW_2') {
    // try to extract column from sqlMessage
    const fkMatch = String(err.sqlMessage || '').match(/FOREIGN KEY \(`([^`]+)`\)/i);
    const column = fkMatch ? fkMatch[1] : null;
    const msg = column
      ? `Valor inválido para el campo '${column}': la fila referenciada no existe.`
      : 'Restricción de clave foránea violada: alguna referencia no existe.';
    return { status: 400, message: msg, code: err.code, errno: err.errno };
  }

  // Duplicate entry
  if (err.errno === 1062 || err.code === 'ER_DUP_ENTRY') {
    // duplicate key message already contains useful info
    return { status: 409, message: err.sqlMessage || 'Entrada duplicada', code: err.code, errno: err.errno };
  }

  // Syntax error / parse error
  if (err.errno === 1064 || err.code === 'ER_PARSE_ERROR') {
    return { status: 400, message: 'Error de sintaxis en la consulta SQL', code: err.code, errno: err.errno };
  }

  // Default: expose a concise message and include code for debugging
  return { status: 500, message: err.sqlMessage || err.message || 'Error de base de datos', code: err.code, errno: err.errno };
}

export function createEmployeeService() {
  return {
    async list(req, res) {
      try {
        const empresaId = req.user.empresa_id;
        const { estado, legajo, documento } = req.query;
        const filters = ['e.empresa_id = ?'];
        const params = [empresaId];
        if (estado) {
          filters.push('e.estado = ?');
          params.push(estado);
        }
        if (legajo) {
          filters.push('e.legajo = ?');
          params.push(legajo);
        }
        if (documento) {
          filters.push('e.numero_documento = ?');
          params.push(documento);
        }

        const [rows] = await pool.query(
          `SELECT e.*, e.sueldo_actual AS sueldo_actual,
                  emp.empresa_id AS empresa_id_ref, emp.nombre AS empresa_nombre, emp.nombre_fantasia AS empresa_nombre_fantasia, emp.cuit AS empresa_cuit,
                  c.cargo_id AS cargo_id_ref, c.nombre AS cargo_nombre, c.descripcion AS cargo_descripcion,
                  s.seccion_id AS seccion_id_ref, s.nombre AS seccion_nombre, s.orden AS seccion_orden, s.estado AS seccion_estado,
                  su.sucursal_id AS sucursal_id_ref, su.nombre AS sucursal_nombre,
                  ct.contrataciones_tipos_id AS contratacion_tipo_id_ref, ct.nombre AS contratacion_nombre,
                  cc.categoria_id AS categoria_id_ref, cc.nombre AS categoria_nombre,
                  cv.convenio_id AS convenio_id_ref, cv.nombre AS convenio_nombre,
                  fp.forma_pago_id AS forma_pago_id_ref, fp.nombre AS forma_pago_nombre, fp.descripcion AS forma_pago_descripcion,
                  ee.estado_id AS estado_id_ref, ee.nombre AS estado_nombre, ee.descripcion AS estado_descripcion, ee.es_activo AS estado_es_activo,
                  cb.cuenta_id AS cuenta_bancaria_id, cb.banco_id AS banco_id_ref, cb.tipo_cuenta_id AS tipo_cuenta_id_ref,
                  cb.numero_cuenta, cb.cbu, cb.alias_cbu, cb.titular, cb.fecha_desde, cb.fecha_hasta, cb.principal AS cuenta_principal,
                  b.banco_id AS banco_id_ref_banco, b.nombre AS banco_nombre
           FROM empleados e
           LEFT JOIN empresas emp ON emp.empresa_id = e.empresa_id
           LEFT JOIN cargos c ON c.cargo_id = e.cargo_id
           LEFT JOIN secciones s ON s.seccion_id = e.seccion_id
           LEFT JOIN sucursales su ON su.sucursal_id = e.sucursal_id
           LEFT JOIN contrataciones_tipos ct ON ct.contrataciones_tipos_id = e.tipo_contratacion_id
           LEFT JOIN convenios_categorias cc ON cc.categoria_id = e.convenio_categoria_id
           LEFT JOIN convenios cv ON cv.convenio_id = cc.convenio_id
           LEFT JOIN formas_pago fp ON fp.forma_pago_id = e.forma_pago_id
           LEFT JOIN estados_empleados ee ON ee.estado_id = e.estado
           LEFT JOIN empleados_cuentas_bancarias cb ON cb.empleado_id = e.empleado_id AND cb.principal = 1
           LEFT JOIN bancos b ON b.banco_id = cb.banco_id
           WHERE ${filters.join(' AND ')}
           ORDER BY e.empleado_id DESC`,
          params
        );

        const employeeIds = rows.map((row) => row.empleado_id);
        const archivosByEmpleadoId = new Map();

        if (employeeIds.length) {
          const [fileRows] = await pool.query(
            `SELECT archivo_id, empresa_id, empleado_id, tipo, alias, nombre_archivo, ruta_archivo, ruta_publica,
                    url_publica, mime_type, extension, tamano_bytes, es_principal, descripcion,
                    created_at, updated_at
             FROM empleados_archivos
             WHERE empresa_id = ? AND empleado_id IN (?)
             ORDER BY es_principal DESC, created_at DESC, archivo_id DESC`,
            [empresaId, employeeIds]
          );

          for (const fileRow of fileRows) {
            const key = String(fileRow.empleado_id);
            if (!archivosByEmpleadoId.has(key)) {
              archivosByEmpleadoId.set(key, []);
            }
            archivosByEmpleadoId.get(key).push(mapEmployeeFileRow(fileRow));
          }
          // Consultar conceptos asignados por empleado (filtrados por empresa_id)
          try {
            const [conceptRows] = await pool.query(
                    `SELECT ec.empleado_concepto_id, ec.empleado_id, ec.concepto_id, ec.unidades, ec.importe, ec.fecha_asignacion,
                      c.descripcion AS concepto_descripcion, c.codigo AS concepto_codigo, c.es_sueldo_basico, c.tipo_concepto_id AS concepto_tipo_id, c.suma_resta AS concepto_suma_resta,
                      ct.conceptos_tipos_id AS tipo_id_ref, ct.nombre AS tipo_nombre, ct.codigo AS tipo_codigo, ct.prioridad AS tipo_prioridad
                     FROM empleados_conceptos ec
                     LEFT JOIN conceptos c ON c.concepto_id = ec.concepto_id
                     LEFT JOIN conceptos_tipos ct ON ct.conceptos_tipos_id = c.tipo_concepto_id
                     WHERE ec.empresa_id = ? AND ec.empleado_id IN (?)
                     ORDER BY COALESCE(ct.prioridad, 0) ASC, (CASE WHEN c.suma_resta = 'S' THEN 0 ELSE 1 END) ASC, c.codigo ASC, ec.fecha_asignacion DESC`,
              [empresaId, employeeIds]
            );
            const conceptosByEmpleado = new Map();
            for (const cr of conceptRows) {
              const k = String(cr.empleado_id);
              if (!conceptosByEmpleado.has(k)) conceptosByEmpleado.set(k, []);
              conceptosByEmpleado.get(k).push({
                empleado_concepto_id: cr.empleado_concepto_id,
                concepto_id: cr.concepto_id,
                unidades: cr.unidades !== null && cr.unidades !== undefined ? Number(cr.unidades) : null,
                importe: cr.importe !== null && cr.importe !== undefined ? Number(cr.importe) : null,
                fecha_asignacion: cr.fecha_asignacion,
                concepto: {
                  nombre: cr.concepto_descripcion ?? null,
                  codigo: cr.concepto_codigo ?? null,
                  es_sueldo_basico: Number(cr.es_sueldo_basico) === 1,
                  suma_resta: cr.concepto_suma_resta ?? null,
                  tipo_concepto: cr.tipo_id_ref ? { tipo_concepto_id: cr.tipo_id_ref, nombre: cr.tipo_nombre ?? null, codigo: cr.tipo_codigo ?? null, prioridad: Number(cr.tipo_prioridad) || 0 } : null
                }
              });
            }
            // sort conceptos per employee following rules: tipo_concepto.prioridad ASC, suma_resta 'S' first, codigo ASC
            for (const [k, arr] of conceptosByEmpleado.entries()) {
              arr.sort((a, b) => {
                const pa = a.concepto.tipo_concepto?.prioridad ?? 0;
                const pb = b.concepto.tipo_concepto?.prioridad ?? 0;
                if (pa !== pb) return pa - pb;
                const sa = a.concepto.suma_resta === 'S' ? 0 : 1;
                const sb = b.concepto.suma_resta === 'S' ? 0 : 1;
                if (sa !== sb) return sa - sb;
                const ca = (a.concepto.codigo ?? '').toString();
                const cb = (b.concepto.codigo ?? '').toString();
                return ca.localeCompare(cb, undefined, { sensitivity: 'base', numeric: true });
              });
            }
            for (const r of rows) {
              r.conceptos = conceptosByEmpleado.get(String(r.empleado_id)) || [];
            }
          } catch (e) {
            console.error('employee list conceptos fetch error:', e);
          }
          // Consultar salarios vigentes para adjuntar como `sueldo_actual` en cada empleado
          try {
            const [salRows] = await pool.query(
              `SELECT es.empleado_id, es.monto
                 FROM empleados_salarios es
                 JOIN (
                   SELECT empleado_id, MAX(fecha_desde) AS fecha_desde
                   FROM empleados_salarios
                   WHERE empresa_id = ? AND empleado_id IN (?) AND fecha_desde <= CURDATE() AND (fecha_hasta IS NULL OR fecha_hasta >= CURDATE())
                   GROUP BY empleado_id
                 ) t ON es.empleado_id = t.empleado_id AND es.fecha_desde = t.fecha_desde`,
              [empresaId, employeeIds]
            );
            const salaryMap = new Map();
            for (const s of salRows) salaryMap.set(String(s.empleado_id), Number(s.monto));
            // attach sueldo_actual to rows
            for (const r of rows) {
              r.sueldo_actual = salaryMap.get(String(r.empleado_id)) ?? null;
            }
          } catch (e) {
            console.error('employee list salary fetch error:', e);
          }
        }

        return res.json(attachArchivos(rows, archivosByEmpleadoId));
      } catch (error) {
        console.error('employee list error:', error);
        return sendError(res, 500, 'Error al listar empleados', error.message);
      }
    },

    async getById(req, res) {
      try {
        const empresaId = req.user.empresa_id;
        const [rows] = await pool.query(
          `SELECT e.*, e.sueldo_actual AS sueldo_actual,
                  emp.empresa_id AS empresa_id_ref, emp.nombre AS empresa_nombre, emp.nombre_fantasia AS empresa_nombre_fantasia, emp.cuit AS empresa_cuit,
                  c.cargo_id AS cargo_id_ref, c.nombre AS cargo_nombre, c.descripcion AS cargo_descripcion,
                  s.seccion_id AS seccion_id_ref, s.nombre AS seccion_nombre, s.orden AS seccion_orden, s.estado AS seccion_estado,
                  su.sucursal_id AS sucursal_id_ref, su.nombre AS sucursal_nombre,
                  ct.contrataciones_tipos_id AS contratacion_tipo_id_ref, ct.nombre AS contratacion_nombre,
                  cc.categoria_id AS categoria_id_ref, cc.nombre AS categoria_nombre,
                  cv.convenio_id AS convenio_id_ref, cv.nombre AS convenio_nombre,
                  fp.forma_pago_id AS forma_pago_id_ref, fp.nombre AS forma_pago_nombre, fp.descripcion AS forma_pago_descripcion,
                  ee.estado_id AS estado_id_ref, ee.nombre AS estado_nombre, ee.descripcion AS estado_descripcion, ee.es_activo AS estado_es_activo,
                  cb.cuenta_id AS cuenta_bancaria_id, cb.banco_id AS banco_id_ref, cb.tipo_cuenta_id AS tipo_cuenta_id_ref,
                  cb.numero_cuenta, cb.cbu, cb.alias_cbu, cb.titular, cb.fecha_desde, cb.fecha_hasta, cb.principal AS cuenta_principal,
                  b.banco_id AS banco_id_ref_banco, b.nombre AS banco_nombre
           FROM empleados e
           LEFT JOIN empresas emp ON emp.empresa_id = e.empresa_id
           LEFT JOIN cargos c ON c.cargo_id = e.cargo_id
           LEFT JOIN secciones s ON s.seccion_id = e.seccion_id
           LEFT JOIN sucursales su ON su.sucursal_id = e.sucursal_id
           LEFT JOIN contrataciones_tipos ct ON ct.contrataciones_tipos_id = e.tipo_contratacion_id
           LEFT JOIN convenios_categorias cc ON cc.categoria_id = e.convenio_categoria_id
           LEFT JOIN convenios cv ON cv.convenio_id = cc.convenio_id
           LEFT JOIN formas_pago fp ON fp.forma_pago_id = e.forma_pago_id
           LEFT JOIN estados_empleados ee ON ee.estado_id = e.estado
           LEFT JOIN empleados_cuentas_bancarias cb ON cb.empleado_id = e.empleado_id AND cb.principal = 1
           LEFT JOIN bancos b ON b.banco_id = cb.banco_id
          WHERE e.empleado_id = ? AND e.empresa_id = ?
           LIMIT 1`,
          [req.params.id, empresaId]
        );

        if (!rows.length) {
          return sendError(res, 404, 'Empleado no encontrado', null);
        }

        // obtener salario vigente para este empleado
        try {
          const [salRows] = await pool.query(
            `SELECT monto FROM empleados_salarios WHERE empresa_id = ? AND empleado_id = ? AND fecha_desde <= CURDATE() AND (fecha_hasta IS NULL OR fecha_hasta >= CURDATE()) ORDER BY fecha_desde DESC LIMIT 1`,
            [empresaId, req.params.id]
          );
          rows[0].sueldo_actual = salRows.length ? Number(salRows[0].monto) : null;
        } catch (e) {
          console.error('employee getById salary fetch error:', e);
          rows[0].sueldo_actual = null;
        }

        const [fileRows] = await pool.query(
          `SELECT archivo_id, empresa_id, empleado_id, tipo, alias, nombre_archivo, ruta_archivo, ruta_publica,
                  url_publica, mime_type, extension, tamano_bytes, es_principal, descripcion,
                  created_at, updated_at
           FROM empleados_archivos
           WHERE empresa_id = ? AND empleado_id = ?
           ORDER BY es_principal DESC, created_at DESC, archivo_id DESC`,
          [empresaId, req.params.id]
        );

        // fetch conceptos asignados para este empleado (empresa scope)
        let conceptosAssigned = [];
        try {
          const [conceptRows] = await pool.query(
            `SELECT ec.empleado_concepto_id, ec.empleado_id, ec.concepto_id, ec.unidades, ec.importe, ec.fecha_asignacion,
                    c.descripcion AS concepto_descripcion, c.codigo AS concepto_codigo, c.es_sueldo_basico, c.tipo_concepto_id AS concepto_tipo_id, c.suma_resta AS concepto_suma_resta,
                    ct.conceptos_tipos_id AS tipo_id_ref, ct.nombre AS tipo_nombre, ct.codigo AS tipo_codigo, ct.prioridad AS tipo_prioridad
             FROM empleados_conceptos ec
             LEFT JOIN conceptos c ON c.concepto_id = ec.concepto_id
             LEFT JOIN conceptos_tipos ct ON ct.conceptos_tipos_id = c.tipo_concepto_id
             WHERE ec.empresa_id = ? AND ec.empleado_id = ?
             ORDER BY ec.fecha_asignacion DESC`,
            [empresaId, req.params.id]
          );
          conceptosAssigned = conceptRows.map((cr) => ({
            empleado_concepto_id: cr.empleado_concepto_id,
            concepto_id: cr.concepto_id,
            unidades: cr.unidades !== null && cr.unidades !== undefined ? Number(cr.unidades) : null,
            importe: cr.importe !== null && cr.importe !== undefined ? Number(cr.importe) : null,
            fecha_asignacion: cr.fecha_asignacion,
            concepto: {
              nombre: cr.concepto_descripcion ?? null,
              codigo: cr.concepto_codigo ?? null,
              es_sueldo_basico: Number(cr.es_sueldo_basico) === 1,
              suma_resta: cr.concepto_suma_resta ?? null,
              tipo_concepto: cr.tipo_id_ref ? { tipo_concepto_id: cr.tipo_id_ref, nombre: cr.tipo_nombre ?? null, codigo: cr.tipo_codigo ?? null, prioridad: Number(cr.tipo_prioridad) || 0 } : null
            }
          }));
          // sort conceptosAssigned by tipo_concepto.prioridad ASC, suma_resta 'S' first, codigo ASC
          conceptosAssigned.sort((a, b) => {
            const pa = a.concepto.tipo_concepto?.prioridad ?? 0;
            const pb = b.concepto.tipo_concepto?.prioridad ?? 0;
            if (pa !== pb) return pa - pb;
            const sa = a.concepto.suma_resta === 'S' ? 0 : 1;
            const sb = b.concepto.suma_resta === 'S' ? 0 : 1;
            if (sa !== sb) return sa - sb;
            const ca = (a.concepto.codigo ?? '').toString();
            const cb = (b.concepto.codigo ?? '').toString();
            return ca.localeCompare(cb, undefined, { sensitivity: 'base', numeric: true });
          });
        } catch (e) {
          console.error('employee getById conceptos fetch error:', e);
        }

        const empleado = mapEmployeeRow(rows[0]);
        empleado.archivos = fileRows.map(mapEmployeeFileRow);
        empleado.conceptos = conceptosAssigned;

        return res.json(empleado);
        } catch (error) {
        console.error('employee getById error:', error);
        return sendError(res, 500, 'Error al obtener empleado', error.message);
      }
    },

    async create(req, res) {
      try {
        const empresaId = req.user.empresa_id;
        const payload = { ...req.body, empresa_id: empresaId };

        if (!payload.legajo || !payload.numero_documento || !payload.nombre || !payload.apellido || !payload.forma_pago_id) {
          return sendError(res, 400, 'legajo, numero_documento, nombre, apellido y forma_pago_id son obligatorios', null);
        }

        if (await exists('SELECT 1 FROM empleados WHERE empresa_id = ? AND legajo = ? LIMIT 1', [empresaId, payload.legajo])) {
          return sendError(res, 409, 'Ya existe un empleado con ese legajo', null);
        }

        if (await exists('SELECT 1 FROM empleados WHERE empresa_id = ? AND numero_documento = ? LIMIT 1', [empresaId, payload.numero_documento])) {
          return sendError(res, 409, 'Ya existe un empleado con ese documento', null);
        }

        const [formaPagoRows] = await pool.query('SELECT requiere_banco, requiere_cbu, requiere_cuenta FROM formas_pago WHERE forma_pago_id = ? AND empresa_id = ? LIMIT 1', [payload.forma_pago_id, empresaId]);
        if (!formaPagoRows.length) {
          return sendError(res, 400, 'La forma de pago no pertenece a la empresa', null);
        }
        const formaPago = formaPagoRows[0];
        if (Number(formaPago.requiere_banco) === 1 && !payload.banco_id) {
          return sendError(res, 400, 'La forma de pago requiere banco', null);
        }
        if (Number(formaPago.requiere_cbu) === 1 && !payload.cbu) {
          return sendError(res, 400, 'La forma de pago requiere CBU', null);
        }
        if (Number(formaPago.requiere_cuenta) === 1 && !payload.numero_cuenta) {
          return sendError(res, 400, 'La forma de pago requiere numero de cuenta', null);
        }

        // validar estado existe para evitar FK error en el INSERT
        const resolvedEstado = resolveEmployeeState(payload, 1);
        if (resolvedEstado !== null && resolvedEstado !== undefined) {
          const [estadoRows] = await pool.query('SELECT estado_id FROM estados_empleados WHERE estado_id = ? LIMIT 1', [resolvedEstado]);
          if (!estadoRows.length) {
            return sendError(res, 400, `Estado inválido: ${resolvedEstado}`, null);
          }
        }

        const [result] = await pool.query(
          `INSERT INTO empleados
             (empresa_id, sucursal_id, seccion_id, cargo_id, legajo, tipo_documento, numero_documento, nombre, apellido,
              fecha_nacimiento, sexo, estado_civil, nacionalidad, direccion, localidad, telefono, email,
              fecha_ingreso, fecha_egreso, tipo_contratacion_id, convenio_categoria_id, dias_trabajados, forma_pago_id, foto, habilitado, estado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              empresaId, payload.sucursal_id ?? null, payload.seccion_id ?? null, payload.cargo_id ?? null,
              payload.legajo, payload.tipo_documento, payload.numero_documento, payload.nombre, payload.apellido,
              nullIfEmpty(payload.fecha_nacimiento) ?? null, payload.sexo ?? null, normalizeEstadoCivil(payload.estado_civil), payload.nacionalidad ?? null,
              payload.direccion ?? null, payload.localidad ?? null, payload.telefono ?? null,
              payload.email ?? null, nullIfEmpty(payload.fecha_ingreso) ?? null, nullIfEmpty(payload.fecha_egreso) ?? null,
              payload.tipo_contratacion_id ?? null, payload.convenio_categoria_id ?? null, payload.dias_trabajados ?? null,
              payload.forma_pago_id, payload.foto ?? null, /* habilitado: por ahora siempre 1 al crear */ 1, resolveEmployeeState(payload, 1),
            ]
        );

        if (payload.banco_id || payload.cbu || payload.alias_cbu || payload.numero_cuenta) {
          await pool.query(
            `INSERT INTO empleados_cuentas_bancarias
             (empresa_id, empleado_id, banco_id, tipo_cuenta_id, numero_cuenta, cbu, alias_cbu, titular, fecha_desde, fecha_hasta, principal, estado_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
            [empresaId, result.insertId, payload.banco_id ?? null, payload.tipo_cuenta_id ?? null, payload.numero_cuenta ?? null, payload.cbu ?? null, payload.alias_cbu ?? null, `${payload.nombre} ${payload.apellido}`, nullIfEmpty(payload.fecha_ingreso) ?? null, nullIfEmpty(payload.fecha_egreso) ?? null]
          );
        }

        // Insertar salario inicial en empleados_salarios
        try {
          let montoInicial = null;
          if (payload.sueldo !== undefined && payload.sueldo !== null) {
            montoInicial = Number(payload.sueldo);
          } else if (payload.convenio_categoria_id) {
            const [ccRows] = await pool.query('SELECT sueldo_basico FROM convenios_categorias WHERE categoria_id = ? LIMIT 1', [payload.convenio_categoria_id]);
            if (ccRows.length) montoInicial = Number(ccRows[0].sueldo_basico);
          }

          if (montoInicial !== null) {
            const fechaDesde = nullIfEmpty(payload.fecha_ingreso) ?? new Date().toISOString().slice(0,10);
            await pool.query(
              `INSERT INTO empleados_salarios (empresa_id, empleado_id, monto, fecha_desde, razon, creado_por)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [empresaId, result.insertId, montoInicial, fechaDesde, 'Inicial al crear empleado', req.user.usuario_id ?? null]
            );
            // Mantener columna empleados.sueldo_actual sincronizada
            try {
              await pool.query('UPDATE empleados SET sueldo_actual = ? WHERE empleado_id = ?', [montoInicial, result.insertId]);
            } catch (e) {
              console.error('employee create sueldo_actual update error:', e);
            }
          }
        } catch (e) {
          console.error('employee create salary insert error:', e);
        }

        const [rows] = await pool.query('SELECT * FROM empleados WHERE empleado_id = ?', [result.insertId]);
        return res.status(201).json(rows[0]);
      } catch (error) {
        console.error('employee create error:', error);
        const formatted = formatDbError(error);
        return res.status(formatted.status).json({ message: 'No se pudo guardar el empleado', error: formatted.message, meta: { code: formatted.code, errno: formatted.errno } });
      }
    },

    async update(req, res) {
      try {
        const empresaId = req.user.empresa_id;
        const [currentRows] = await pool.query('SELECT * FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1', [req.params.id, empresaId]);
        if (!currentRows.length) return res.status(404).json({ message: 'Empleado no encontrado' });

        const current = currentRows[0];
        const payload = { ...current, ...req.body };

        const [formaPagoRows] = await pool.query('SELECT requiere_banco, requiere_cbu, requiere_cuenta FROM formas_pago WHERE forma_pago_id = ? AND empresa_id = ? LIMIT 1', [payload.forma_pago_id, empresaId]);
        if (!formaPagoRows.length) return res.status(400).json({ message: 'La forma de pago no pertenece a la empresa' });
        const formaPago = formaPagoRows[0];
        if (Number(formaPago.requiere_banco) === 1 && !payload.banco_id && !payload.cbu) return res.status(400).json({ message: 'La forma de pago requiere banco o CBU' });

        // validar estado existe para evitar FK error en el UPDATE
        const resolvedEstadoUpd = resolveEmployeeState(payload, current.estado);
        if (resolvedEstadoUpd !== null && resolvedEstadoUpd !== undefined) {
          const [estadoRowsUpd] = await pool.query('SELECT estado_id FROM estados_empleados WHERE estado_id = ? LIMIT 1', [resolvedEstadoUpd]);
          if (!estadoRowsUpd.length) {
            return res.status(400).json({ message: `Estado inválido: ${resolvedEstadoUpd}` });
          }
        }

        if (payload.legajo !== current.legajo && await exists('SELECT 1 FROM empleados WHERE empresa_id = ? AND legajo = ? AND empleado_id <> ? LIMIT 1', [empresaId, payload.legajo, req.params.id])) {
          return res.status(409).json({ message: 'Ya existe un empleado con ese legajo' });
        }

        if (payload.numero_documento !== current.numero_documento && await exists('SELECT 1 FROM empleados WHERE empresa_id = ? AND numero_documento = ? AND empleado_id <> ? LIMIT 1', [empresaId, payload.numero_documento, req.params.id])) {
          return res.status(409).json({ message: 'Ya existe un empleado con ese documento' });
        }

        await pool.query(
          `UPDATE empleados SET sucursal_id = ?, seccion_id = ?, cargo_id = ?, legajo = ?, tipo_documento = ?, numero_documento = ?, nombre = ?, apellido = ?,
           fecha_nacimiento = ?, sexo = ?, estado_civil = ?, nacionalidad = ?, direccion = ?, localidad = ?, telefono = ?, email = ?,
           fecha_ingreso = ?, fecha_egreso = ?, tipo_contratacion_id = ?, convenio_categoria_id = ?, dias_trabajados = ?, forma_pago_id = ?, foto = ?, habilitado = ?, estado = ?
           WHERE empleado_id = ? AND empresa_id = ?`,
          [
            payload.sucursal_id ?? null, payload.seccion_id ?? null, payload.cargo_id ?? null, payload.legajo,
            payload.tipo_documento, payload.numero_documento, payload.nombre, payload.apellido, nullIfEmpty(payload.fecha_nacimiento) ?? null,
            payload.sexo ?? null, normalizeEstadoCivil(payload.estado_civil), payload.nacionalidad ?? null, payload.direccion ?? null,
            payload.localidad ?? null, payload.telefono ?? null, payload.email ?? null,
            nullIfEmpty(payload.fecha_ingreso) ?? null, nullIfEmpty(payload.fecha_egreso) ?? null, payload.tipo_contratacion_id ?? null,
            payload.convenio_categoria_id ?? null, payload.dias_trabajados ?? null, payload.forma_pago_id,
            payload.foto ?? null, /* ignorar payload.habilitado en update; mantener valor actual */ current.habilitado, resolveEmployeeState(payload, current.estado), req.params.id, empresaId,
          ]
        );

        // Si cambió convenio_categoria o se proporcionó un nuevo sueldo, insertar nuevo registro en empleados_salarios
        try {
          const nuevoSueldo = payload.sueldo !== undefined ? Number(payload.sueldo) : null;
          const convenioCambio = payload.convenio_categoria_id && payload.convenio_categoria_id !== current.convenio_categoria_id;
          if (nuevoSueldo !== null || convenioCambio) {
            let montoInsert = nuevoSueldo;
            if (montoInsert === null && convenioCambio) {
              const [ccRowsUpd] = await pool.query('SELECT sueldo_basico FROM convenios_categorias WHERE categoria_id = ? LIMIT 1', [payload.convenio_categoria_id]);
              if (ccRowsUpd.length) montoInsert = Number(ccRowsUpd[0].sueldo_basico);
            }
            if (montoInsert !== null) {
              const fechaDesdeUpd = nullIfEmpty(payload.sueldo_fecha) ?? new Date().toISOString().slice(0,10);
              await pool.query(
                `INSERT INTO empleados_salarios (empresa_id, empleado_id, monto, fecha_desde, razon, creado_por)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [empresaId, req.params.id, montoInsert, fechaDesdeUpd, convenioCambio ? 'Cambio convenio_categoria' : 'Actualización manual', req.user.usuario_id ?? null]
              );
              // actualizar campo sueldo_actual en empleados
              try {
                await pool.query('UPDATE empleados SET sueldo_actual = ? WHERE empleado_id = ?', [montoInsert, req.params.id]);
              } catch (e) {
                console.error('employee update sueldo_actual update error:', e);
              }
            }
          }
        } catch (e) {
          console.error('employee update salary insert error:', e);
        }

        if (payload.banco_id || payload.cbu || payload.alias_cbu || payload.numero_cuenta) {
          await pool.query('DELETE FROM empleados_cuentas_bancarias WHERE empleado_id = ? AND empresa_id = ?', [req.params.id, empresaId]);
          await pool.query(
            `INSERT INTO empleados_cuentas_bancarias
             (empresa_id, empleado_id, banco_id, tipo_cuenta_id, numero_cuenta, cbu, alias_cbu, titular, fecha_desde, fecha_hasta, principal, estado_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
            [empresaId, req.params.id, payload.banco_id ?? null, payload.tipo_cuenta_id ?? null, payload.numero_cuenta ?? null, payload.cbu ?? null, payload.alias_cbu ?? null, `${payload.nombre} ${payload.apellido}`, nullIfEmpty(payload.fecha_ingreso) ?? null, nullIfEmpty(payload.fecha_egreso) ?? null]
          );
        }

        const [updated] = await pool.query('SELECT * FROM empleados WHERE empleado_id = ?', [req.params.id]);
        return res.json(updated[0]);
      } catch (error) {
        console.error('employee update error:', error);
        const formatted = formatDbError(error);
        return res.status(formatted.status).json({ message: 'No se pudo actualizar el empleado', error: formatted.message, meta: { code: formatted.code, errno: formatted.errno } });
      }
    },

    async remove(req, res) {
      try {
        const empresaId = req.user.empresa_id;
        const [result] = await pool.query('DELETE FROM empleados WHERE empleado_id = ? AND empresa_id = ?', [req.params.id, empresaId]);
        if (!result.affectedRows) return res.status(404).json({ message: 'Empleado no encontrado' });
        return res.status(204).send();
      } catch (error) {
        console.error('employee delete error:', error);
        const formatted = formatDbError(error);
        return res.status(formatted.status).json({ message: 'No se pudo eliminar el empleado', error: formatted.message, meta: { code: formatted.code, errno: formatted.errno } });
      }
    },
  };
}
