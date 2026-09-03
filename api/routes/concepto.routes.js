import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';
import conceptoModel from '../models/concepto.model.js';
import pool from '../db.js';

// lazy Redis client: import/connect only if REDIS_URL is set and package is installed
let redisClient = null;
const REDIS_URL = process.env.REDIS_URL || null;
async function getRedisClient() {
  if (!REDIS_URL) return null;
  if (redisClient) return redisClient;
  try {
    const { createClient } = await import('redis');
    redisClient = createClient({ url: REDIS_URL });
    await redisClient.connect();
    return redisClient;
  } catch (e) {
    console.error('redis init error (continuing without cache):', e.message || e);
    redisClient = null;
    return null;
  }
}

const controller = createCrudController({
  table: 'conceptos',
  pk: 'concepto_id',
  columns: conceptoModel.columns,
  companyScoped: true,
  listOrderBy: 'concepto_id DESC',
  nullableColumns: ['multiplicador', 'divisor', 'importe_fijo', 'detalle'],
});

const router = Router();
router.use(authenticateToken);

async function hasVerCatalogoPermission(rolId, empresaId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM rolPermiso rp
     INNER JOIN permiso p ON p.id = rp.permisoId
     WHERE rp.rolId = ? AND rp.empresa_id = ? AND p.alias = 'ver_catalogo' AND rp.estado = 1 AND p.estado = 1`,
    [rolId, empresaId]
  );
  return rows[0].cnt > 0;
}

// Resolve permite_importe_fijo: prefer grupo, fallback tipo, default 0
async function resolvePermiteImporte(empresaId, grupoId /* tipoId deprecated for permite_importe_fijo */) {
  try {
    if (grupoId) {
      const [gRows] = await pool.query('SELECT permite_importe_fijo FROM grupos_conceptos_master WHERE grupo_id = ? AND empresa_id = ? LIMIT 1', [grupoId, empresaId]);
      if (gRows.length && gRows[0].permite_importe_fijo !== undefined && gRows[0].permite_importe_fijo !== null) return Number(gRows[0].permite_importe_fijo);
    }
  } catch (e) {
    console.error('resolvePermiteImporte error:', e.message || e);
  }
  return 0;
}

// etiquetas en español (UI-friendly)
const accionLabels = { reject: 'Rechazar', clamp: 'Ajustar', warn: 'Advertir' };
const tipoLabels = { max: 'Máximo', min: 'Mínimo' };

async function hasPermission(alias, rolId, empresaId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM rolPermiso rp
     INNER JOIN permiso p ON p.id = rp.permisoId
     WHERE p.alias = ? AND rp.rolId = ? AND rp.empresa_id = ? AND rp.estado = 1 AND p.estado = 1`,
    [alias, rolId, empresaId]
  );
  return rows[0].cnt > 0;
}

// Buscar el tope aplicable por prioridad: concepto -> grupo -> empresa/global
async function findTopApplicable(empresaId, conceptoId, grupoId, fecha = null) {
  const q = `
    SELECT * FROM conceptos_topes t
    WHERE t.empresa_id = ?
      AND (t.concepto_id = ? OR (t.concepto_id IS NULL AND t.grupo_id = ?) OR (t.concepto_id IS NULL AND t.grupo_id IS NULL))
      AND t.activo = 1
      AND (t.fecha_desde IS NULL OR t.fecha_desde <= COALESCE(?, CURDATE()))
      AND (t.fecha_hasta IS NULL OR t.fecha_hasta >= COALESCE(?, CURDATE()))
    ORDER BY
      CASE WHEN t.concepto_id IS NOT NULL THEN 1 WHEN t.grupo_id IS NOT NULL THEN 2 ELSE 3 END ASC,
      t.tope_id DESC
    LIMIT 1`;
  const dateParam = fecha ?? null;
  const [rows] = await pool.query(q, [empresaId, conceptoId, grupoId, dateParam, dateParam]);
  if (!rows.length) return null;
  const t = rows[0];
  t.accion_label = accionLabels[t.accion] ?? t.accion;
  t.tipo_label = tipoLabels[t.tipo] ?? t.tipo;
  return t;
}

function computeTopValue(tope, baseValue = null) {
  if (!tope) return null;
  if (String(tope.unidad) === 'porcentaje') {
    const base = baseValue ?? 0;
    return Number(((base * Number(tope.valor)) / 100).toFixed(2));
  }
  return Number(tope.valor);
}

// Custom search endpoint with q, codigo, estado, pagination
router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;

    // Authorization: use company from token; no permiso requerido for search

    const { q, codigo, estado } = req.query;
    const pageRaw = req.query.page;
    const perPageRaw = req.query.per_page;

    if (q && String(q).trim().length > 0 && String(q).trim().length < 2) {
      return res.status(400).json({ error: 'q debe tener al menos 2 caracteres' });
    }

    const page = pageRaw ? Math.max(1, parseInt(pageRaw, 10)) : null;
    const per_page = perPageRaw ? Math.min(500, Math.max(1, parseInt(perPageRaw, 10))) : null;
    if (perPageRaw && (!per_page || per_page > 500)) return res.status(400).json({ error: 'per_page debe ser <= 500' });

    // Build WHERE clause safely with params
    const where = ['c.empresa_id = ?'];
    const params = [empresaId];

    // the 'conceptos' table may not have an 'estado' column; ignore estado filter for now

    let searchClause = '';
    if (q && String(q).trim().length >= 2) {
      const term = `%${String(q).trim().toLowerCase()}%`;
      // buscar en descripcion, detalle y codigo
      where.push('(LOWER(c.descripcion) LIKE ? OR LOWER(c.detalle) LIKE ? OR LOWER(c.codigo) LIKE ?)');
      params.push(term, term, term);
    }

    if (codigo) {
      const code = `%${String(codigo).trim()}%`;
      where.push('c.codigo LIKE ?');
      params.push(code);
      // prefer codigo matches in ordering
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // build cache key
    const cacheKey = `conceptos:${empresaId}:q:${q ?? ''}:codigo:${codigo ?? ''}:estado:${estado ?? ''}:page:${page ?? 0}:pp:${per_page ?? 0}`;

    // try cache
    try {
      const client = await getRedisClient();
      if (client) {
        const cached = await client.get(cacheKey);
        if (cached) {
          const payload = JSON.parse(cached);
          payload._cache = 'HIT';
          return res.json(payload);
        }
      }
    } catch (e) {
      console.error('redis get error', e);
    }

    // count total when paginating
    let total = null;
    if (page || per_page) {
      const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM conceptos c ${whereSql}`, params);
      total = countRows[0].total || 0;
    }

    // limit/offset
    const capDefault = 1000;
    const limit = per_page ?? capDefault;
    const offset = page && per_page ? (page - 1) * per_page : 0;

    // ordering: tipo_concepto.prioridad ASC, suma_resta 'S' first, codigo ASC
    const orderBy = `COALESCE(ct.prioridad, 0) ASC, (CASE WHEN c.suma_resta = 'S' THEN 0 ELSE 1 END) ASC, c.codigo ASC`;
    const finalParams = [...params, limit, offset];

            const sql = `SELECT c.concepto_id, c.empresa_id, c.codigo, c.descripcion, c.detalle, c.importe_fijo, c.multiplicador, c.divisor, c.suma_resta, c.es_sueldo_basico, c.sueldo_basico_key, c.tipo_concepto_id, c.grupo_id,
                ct.codigo AS tipo_codigo, ct.nombre AS tipo_nombre, ct.prioridad AS tipo_prioridad,
                g.grupo_id AS grupo_id_ref, g.nombre AS grupo_nombre, g.descripcion AS grupo_descripcion, g.permite_importe_fijo AS grupo_permite_importe_fijo
            FROM conceptos c
            LEFT JOIN conceptos_tipos ct ON ct.conceptos_tipos_id = c.tipo_concepto_id
            LEFT JOIN grupos_conceptos_master g ON g.grupo_id = c.grupo_id
            ${whereSql}
              ORDER BY ${orderBy}
            LIMIT ? OFFSET ?`;

    const [rows] = await pool.query(sql, finalParams);

    // normalize rows: nest tipo_concepto
    const normalized = rows.map((r) => {
      const tipo = {
        tipo_concepto_id: r.tipo_concepto_id,
        codigo: r.tipo_codigo ?? null,
        nombre: r.tipo_nombre ?? null,
        prioridad: r.tipo_prioridad ?? 0,
      };
      const grupo = {
        grupo_id: r.grupo_id_ref ?? r.grupo_id,
        nombre: r.grupo_nombre ?? null,
        descripcion: r.grupo_descripcion ?? null,
        permite_importe_fijo: r.grupo_permite_importe_fijo !== undefined && r.grupo_permite_importe_fijo !== null
          ? Number(r.grupo_permite_importe_fijo)
          : 0,
      };
      const out = { ...r };
      delete out.tipo_codigo;
      delete out.tipo_nombre;
      delete out.tipo_prioridad;
      delete out.grupo_id_ref;
      delete out.grupo_nombre;
      delete out.grupo_descripcion;
      delete out.grupo_permite_importe_fijo;
      out.tipo_concepto = tipo;
      out.grupo = grupo;
      // top-level convenience field for UI badges
      out.grupo_nombre = grupo.nombre ?? null;
      return out;
    });

    const meta = { total: total ?? normalized.length, page: page ?? 1, per_page: limit, returned: normalized.length };
    const result = { data: normalized, meta };

    // set cache TTL 60s
    try {
      const client = await getRedisClient();
      if (client) {
        await client.setEx(cacheKey, 60, JSON.stringify(result));
      }
    } catch (e) {
      console.error('redis set error', e);
    }

    return res.json(result);
  } catch (error) {
    console.error('conceptos search error:', error);
    return res.status(500).json({ error: 'Error al buscar conceptos' });
  }
});

// Preview: calcular importe de un concepto en contexto (empleado)
router.post('/preview', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const { concepto_id, empleado_id, importe: overrideImporte, unidades: unidadesRaw, razon_override } = req.body || {};

    if (!concepto_id || !Number.isInteger(Number(concepto_id))) return res.status(400).json({ error: 'concepto_id inválido' });

    const conceptoId = Number(concepto_id);
    const empleadoId = empleado_id ? Number(empleado_id) : null;

    // obtener concepto + grupo para decidir topes
    const [cRows] = await pool.query(
      `SELECT c.concepto_id, c.importe_fijo, c.es_sueldo_basico, c.grupo_id
       FROM conceptos c
       WHERE c.concepto_id = ? AND c.empresa_id = ? LIMIT 1`,
      [conceptoId, empresaId]
    );
    if (!cRows.length) return res.status(404).json({ error: 'Concepto no encontrado' });
    const concepto = cRows[0];
    const grupoId = concepto.grupo_id ?? null;

    // resolver importe base (misma lógica previa para sueldo básico/empleado)
    let importe = null;
    let source = null;
    if (Number(concepto.es_sueldo_basico) === 1 && empleadoId) {
      try {
        const [empRows] = await pool.query('SELECT convenio_categoria_id, sueldo_actual FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1', [empleadoId, empresaId]);
        const empleado = empRows[0] ?? null;
        const empleadoCategoriaId = empleado ? empleado.convenio_categoria_id : null;
        if (empleadoCategoriaId) {
          const [ccRows] = await pool.query('SELECT sueldo_basico FROM convenios_categorias WHERE categoria_id = ? LIMIT 1', [empleadoCategoriaId]);
          if (ccRows.length && Number(ccRows[0].sueldo_basico) > 0) {
            importe = Number(ccRows[0].sueldo_basico);
            source = 'convenio_categoria.sueldo_basico';
          }
        }
        if (importe === null && empleado && Number(empleado.sueldo_actual) > 0) {
          importe = Number(empleado.sueldo_actual);
          source = 'empleados.sueldo_actual';
        }
        if (importe === null) {
          const [lastSal] = await pool.query('SELECT monto FROM empleados_salarios WHERE empleado_id = ? AND empresa_id = ? ORDER BY fecha_desde DESC LIMIT 1', [empleadoId, empresaId]);
          if (lastSal.length && Number(lastSal[0].monto) > 0) {
            importe = Number(lastSal[0].monto);
            source = 'empleados_salarios.ultimo';
          }
        }
      } catch (e) {
        console.error('preview sueldo_basico error:', e.message || e);
      }
    }

    // fallback conceptual
    if (importe === null && Number(concepto.importe_fijo) && Number(concepto.importe_fijo) > 0) {
      importe = Number(concepto.importe_fijo);
      source = 'concepto.importe_fijo';
    }

    // override provisional
    if ((importe === null || overrideImporte !== undefined) && overrideImporte !== undefined && overrideImporte !== null) {
      const parsed = Number(overrideImporte);
      if (!Number.isNaN(parsed)) {
        importe = parsed;
        source = 'override';
      }
    }

    // unidades
    const unidades = unidadesRaw !== undefined && unidadesRaw !== null ? Number(unidadesRaw) : 1;

    // Buscar tope aplicable
    const tope = await findTopApplicable(empresaId, conceptoId, grupoId);
    if (!tope) {
      return res.json({ concepto_id: conceptoId, empleado_id: empleadoId, unidades: Number.isFinite(unidades) ? unidades : 1, importe: importe === null ? null : Number(importe), source });
    }

    // si la unidad es porcentaje, necesitamos base para calcular tope efectivo
    let baseParaPorcentaje = null;
    if (String(tope.unidad) === 'porcentaje') {
      try {
        if (empleadoId) {
          const [empRows] = await pool.query('SELECT sueldo_actual FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1', [empleadoId, empresaId]);
          baseParaPorcentaje = empRows[0] ? Number(empRows[0].sueldo_actual || 0) : 0;
        }
      } catch (e) {
        baseParaPorcentaje = 0;
      }
    }

    const topeValor = computeTopValue(tope, baseParaPorcentaje);

    // evaluar exceso o incumplimiento
    const tipo = String(tope.tipo);
    let excede = false;
    if (tipo === 'max' && importe !== null && Number(importe) > topeValor) excede = true;
    if (tipo === 'min' && importe !== null && Number(importe) < topeValor) excede = true;

    // respuesta base con etiquetas
    const topeMeta = {
      tope_id: tope.tope_id,
      tipo: tope.tipo,
      tipo_label: tope.tipo_label,
      accion: tope.accion,
      accion_label: tope.accion_label,
      unidad: tope.unidad,
      valor: tope.valor,
      valor_efectivo: topeValor,
      requiere_override: Number(tope.requiere_override) === 1
    };

    if (!excede) {
      return res.json({ concepto_id: conceptoId, empleado_id: empleadoId, unidades: Number.isFinite(unidades) ? unidades : 1, importe: importe === null ? null : Number(importe), source, tope: topeMeta });
    }

    // si excede, aplicar acción
    if (tope.accion === 'reject') {
      if (topeMeta.requiere_override) {
        const ok = await hasPermission('topes_override', rolId, empresaId);
        if (!ok) return res.status(403).json({ error: `Permiso requerido: topes_override. Contacte a RRHH.` });
        if (!razon_override) return res.status(400).json({ error: 'Se requiere razon_override para sobrepasar el tope.' });
        // auditar override
        try {
          const usuarioId = req.user?.usuario_id ?? null;
          await pool.query(
            `INSERT INTO auditoria_global (empresa_id, usuario_id, table_name, pk_name, pk_value, action, old_values, new_values, reason) VALUES (?, ?, ?, ?, ?, 'update', ?, ?, ?)`,
            [empresaId, usuarioId, 'conceptos', 'concepto_id', String(conceptoId), JSON.stringify({ importe_before: null }), JSON.stringify({ override_applied: true, importe_after: Number(importe) }), razon_override]
          );
        } catch (e) {
          console.error('audit insert error (override):', e.message || e);
        }
        return res.json({ concepto_id: conceptoId, empleado_id: empleadoId, unidades: Number.isFinite(unidades) ? unidades : 1, importe: Number(importe), source: 'override', tope: topeMeta, override_applied: true });
      }
      return res.status(400).json({ error: `El importe supera el tope ${topeMeta.tipo_label} ${topeMeta.valor}. Remueva importe o modifique el tope.` });
    }

    if (tope.accion === 'clamp') {
      // si requiere override, exigir permiso y razon
      if (topeMeta.requiere_override) {
        const ok = await hasPermission('topes_override', rolId, empresaId);
        if (!ok) return res.status(403).json({ error: `Permiso requerido: topes_override. Contacte a RRHH.` });
        if (!razon_override) return res.status(400).json({ error: 'Se requiere razon_override para sobrepasar el tope.' });
        try {
          const usuarioId = req.user?.usuario_id ?? null;
          await pool.query(
            `INSERT INTO auditoria_global (empresa_id, usuario_id, table_name, pk_name, pk_value, action, old_values, new_values, reason) VALUES (?, ?, ?, ?, ?, 'update', ?, ?, ?)`,
            [empresaId, usuarioId, 'conceptos', 'concepto_id', String(conceptoId), JSON.stringify({ importe_before: Number(importe) }), JSON.stringify({ clamped_to: topeValor }), razon_override]
          );
        } catch (e) {
          console.error('audit insert error (clamp override):', e.message || e);
        }
      }
      // devolver importe ajustado
      return res.json({ concepto_id: conceptoId, empleado_id: empleadoId, unidades: Number.isFinite(unidades) ? unidades : 1, importe: Number(topeValor), clamped: true, source: 'clamp', tope: topeMeta });
    }

    if (tope.accion === 'warn') {
      return res.json({ concepto_id: conceptoId, empleado_id: empleadoId, unidades: Number.isFinite(unidades) ? unidades : 1, importe: Number(importe), source, warnings: [`El importe supera el tope ${topeMeta.tipo_label} ${topeMeta.valor}`], tope: topeMeta });
    }
    // fallback
    return res.json({ concepto_id: conceptoId, empleado_id: empleadoId, unidades: Number.isFinite(unidades) ? unidades : 1, importe: Number(importe), source, tope: topeMeta });
  } catch (error) {
    console.error('concepto preview error:', error);
    return res.status(500).json({ error: 'Error al calcular preview' });
  }
});

// Listar topes aplicables para un concepto (concepto -> grupo -> global)
router.get('/:id/topes', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const conceptoId = Number(req.params.id);
    if (!Number.isInteger(conceptoId) || conceptoId <= 0) return res.status(400).json({ error: 'concepto_id inválido' });
    // obtener grupo del concepto
    const [cRows] = await pool.query('SELECT grupo_id FROM conceptos WHERE concepto_id = ? AND empresa_id = ? LIMIT 1', [conceptoId, empresaId]);
    if (!cRows.length) return res.status(404).json({ error: 'Concepto no encontrado' });
    const grupoId = cRows[0].grupo_id ?? null;
    const q = `
      SELECT t.* FROM conceptos_topes t
      WHERE t.empresa_id = ?
        AND (t.concepto_id = ? OR (t.concepto_id IS NULL AND t.grupo_id = ?) OR (t.concepto_id IS NULL AND t.grupo_id IS NULL))
      ORDER BY CASE WHEN t.concepto_id IS NOT NULL THEN 1 WHEN t.grupo_id IS NOT NULL THEN 2 ELSE 3 END ASC, t.tope_id DESC`;
    const [rows] = await pool.query(q, [empresaId, conceptoId, grupoId]);
    const out = rows.map((t) => {
      t.accion_label = accionLabels[t.accion] ?? t.accion;
      t.tipo_label = tipoLabels[t.tipo] ?? t.tipo;
      return t;
    });
    return res.json({ data: out });
  } catch (e) {
    console.error('concepto topes list error:', e);
    return res.status(500).json({ error: 'Error al listar topes' });
  }
});

// keep CRUD endpoints for individual operations
router.get('/:id', controller.getById);

// Custom create to enforce single `es_sueldo_basico` per company and set default sueldo_basico_key
router.post('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const payload = req.body || {};
    // coerce es_sueldo_basico
    const esSueldo = payload.es_sueldo_basico !== undefined ? (Number(payload.es_sueldo_basico) === 1 ? 1 : 0) : 0;
    if (esSueldo === 1) {
      // clear existing sueldo basico flags for company
      try {
        await pool.query('UPDATE conceptos SET es_sueldo_basico = 0 WHERE empresa_id = ?', [empresaId]);
      } catch (e) {
        console.error('warning clearing previous es_sueldo_basico:', e);
      }
      payload.es_sueldo_basico = 1;
    }
    // ensure empresa_id present
    if (!payload.empresa_id) payload.empresa_id = empresaId;
    // accept grupo_id as object { grupo_id: X } or { id: X }
    if (payload.grupo_id && typeof payload.grupo_id === 'object') {
      payload.grupo_id = payload.grupo_id.grupo_id ?? payload.grupo_id.id ?? payload.grupo_id;
    }
    // validate importe_fijo against group/tipo policy
    try {
      const permite = await resolvePermiteImporte(payload.empresa_id, payload.grupo_id);
      if (permite === 0 && payload.importe_fijo !== undefined && payload.importe_fijo !== null && Number(payload.importe_fijo) > 0) {
        return res.status(400).json({ error: 'El grupo no permite importe fijo. Remueva `importe_fijo` o habilite en el grupo.' });
      }
    } catch (e) {
      console.error('create permiso check error:', e.message || e);
    }
    req.body = payload;
    return await controller.create(req, res);
  } catch (e) {
    console.error('concepto create wrapper error:', e);
    return res.status(500).json({ error: 'Error al crear concepto' });
  }
});

// Custom update to enforce single `es_sueldo_basico` per company when toggled on
router.put('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const payload = req.body || {};
    const esSueldo = payload.es_sueldo_basico !== undefined ? (Number(payload.es_sueldo_basico) === 1 ? 1 : 0) : null;
    const id = req.params.id;
    // fetch existing to determine grupo/tipo when payload doesn't include them
    const [existingRows] = await pool.query('SELECT grupo_id, tipo_concepto_id FROM conceptos WHERE concepto_id = ? AND empresa_id = ? LIMIT 1', [id, empresaId]);
    if (!existingRows.length) return res.status(404).json({ error: 'Concepto no encontrado' });
    const existing = existingRows[0];
    // accept grupo_id as object { grupo_id: X } or { id: X }
    if (payload.grupo_id && typeof payload.grupo_id === 'object') {
      payload.grupo_id = payload.grupo_id.grupo_id ?? payload.grupo_id.id ?? payload.grupo_id;
    }
    const grupoId = payload.grupo_id !== undefined && payload.grupo_id !== null ? payload.grupo_id : existing.grupo_id;
    const tipoId = payload.tipo_concepto_id !== undefined && payload.tipo_concepto_id !== null ? payload.tipo_concepto_id : existing.tipo_concepto_id;
    // validate importe_fijo against group/tipo policy
    try {
      const permite = await resolvePermiteImporte(empresaId, grupoId);
      if (permite === 0 && payload.importe_fijo !== undefined && payload.importe_fijo !== null && Number(payload.importe_fijo) > 0) {
        return res.status(400).json({ error: 'El grupo no permite importe fijo. Remueva `importe_fijo` o habilite en el grupo.' });
      }
    } catch (e) {
      console.error('update permiso check error:', e.message || e);
    }
    if (esSueldo === 1) {
      try {
        await pool.query('UPDATE conceptos SET es_sueldo_basico = 0 WHERE empresa_id = ? AND concepto_id != ?', [empresaId, id]);
      } catch (e) {
        console.error('warning clearing previous es_sueldo_basico on update:', e);
      }
      payload.es_sueldo_basico = 1;
    }
    req.body = payload;
    return await controller.update(req, res);
  } catch (e) {
    console.error('concepto update wrapper error:', e);
    return res.status(500).json({ error: 'Error al actualizar concepto' });
  }
});

// router.post('/', controller.create); // handled by custom wrapper above
router.delete('/:id', controller.remove);

export default router;
