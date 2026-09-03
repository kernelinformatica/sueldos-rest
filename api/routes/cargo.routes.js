import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';
import pool from '../db.js';

const controller = createCrudController({
  table: 'cargos',
  pk: 'cargo_id',
  companyScoped: true,
  listOrderBy: 'cargo_id DESC',
});

const cache = new Map();

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

async function hasPermission(alias, rolId, empresaId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM rolPermiso rp
     INNER JOIN permiso p ON p.id = rp.permisoId
     WHERE rp.rolId = ? AND rp.empresa_id = ? AND p.alias = ? AND rp.estado = 1 AND p.estado = 1`,
    [rolId, empresaId, alias]
  );
  return rows[0].cnt > 0;
}

async function canViewCargos(rolId, empresaId) {
  return hasPermission('cargos', rolId, empresaId) || hasVerCatalogoPermission(rolId, empresaId);
}

async function canAddCargos(rolId, empresaId) {
  return hasPermission('cargos_agregar', rolId, empresaId);
}

async function canEditCargos(rolId, empresaId) {
  return hasPermission('cargos_editar', rolId, empresaId);
}

async function canDeleteCargos(rolId, empresaId) {
  return hasPermission('cargos_eliminar', rolId, empresaId)
    || hasPermission('cargos_borrar', rolId, empresaId);
}

async function canRelateCargos(rolId, empresaId) {
  return hasPermission('cargos_relacionar', rolId, empresaId);
}

async function attachCargoRelations(rows, empresaId) {
  if (!rows.length) return rows;

  const seccionIds = [...new Set(rows.map((row) => row.seccion_id).filter((value) => value !== null && value !== undefined))];
  if (!seccionIds.length) {
    return rows.map((row) => ({ ...row, seccion: {}, sucursal: {} }));
  }

  const placeholders = seccionIds.map(() => '?').join(',');
  const [secciones] = await pool.query(
    `SELECT s.seccion_id, s.sucursal_id, s.nombre, s.orden, s.estado AS estado_id,
            su.empresa_id AS empresa_id_ref, su.nombre AS sucursal_nombre
     FROM secciones s
     INNER JOIN sucursales su ON su.sucursal_id = s.sucursal_id
     WHERE su.empresa_id = ? AND s.seccion_id IN (${placeholders})`,
    [empresaId, ...seccionIds]
  );

  const sucursalIds = [...new Set(secciones.map((row) => row.sucursal_id).filter((value) => value !== null && value !== undefined))];
  let sucursalesById = new Map();
  if (sucursalIds.length) {
    const sucursalPlaceholders = sucursalIds.map(() => '?').join(',');
    const [sucursales] = await pool.query(
      `SELECT sucursal_id, cod_interno, empresa_id, nombre, direccion, localidad_id, latitud, longitud, resp_sucursal, principal, estado, orden
       FROM sucursales
       WHERE empresa_id = ? AND sucursal_id IN (${sucursalPlaceholders})`,
      [empresaId, ...sucursalIds]
    );
    sucursalesById = new Map(sucursales.map((row) => [String(row.sucursal_id), row]));
  }

  const seccionesById = new Map(secciones.map((row) => [String(row.seccion_id), row]));

  return rows.map((row) => {
    const seccion = seccionesById.get(String(row.seccion_id)) || {};
    const sucursal = seccion.sucursal_id ? (sucursalesById.get(String(seccion.sucursal_id)) || {}) : {};
    return {
      ...row,
      seccion,
      sucursal,
    };
  });
}

const router = Router();
router.use(authenticateToken);

// Devuelve todos los cargos de la empresa (sin paginación ni filtros)
router.get('/all', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const [rows] = await pool.query(
      `SELECT cargo_id, empresa_id, seccion_id, nombre, abreviatura, responsable, descripcion, estado_id
       FROM cargos
       WHERE empresa_id = ? AND estado_id = 1
       ORDER BY nombre ASC`,
      [empresaId]
    );
    const data = await attachCargoRelations(rows, empresaId);
    return res.json({ data, meta: { total: data.length } });
  } catch (error) {
    console.error('cargos all error:', error);
    return res.status(500).json({ error: 'Error al listar todos los cargos' });
  }
});

router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;

    const ok = await canViewCargos(rolId, empresaId);
    if (!ok) return res.status(401).json({ error: 'No autorizado' });

    const seccionIdRaw = req.query.seccion_id;
    if (!seccionIdRaw) return res.status(400).json({ error: 'seccion_id es obligatorio' });
    const seccionId = parseInt(seccionIdRaw, 10);
    if (!Number.isInteger(seccionId) || seccionId <= 0) return res.status(400).json({ error: 'seccion_id inválido' });

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const perPage = Math.min(500, Math.max(1, parseInt(req.query.per_page || '1000', 10)));
    const offset = (page - 1) * perPage;

    const cacheKey = `cargos:${seccionId}:p${page}:pp${perPage}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > now) return res.json({ data: cached.data, meta: cached.meta, cache: 'HIT' });

    const [rows] = await pool.query(
      `SELECT cargo_id, empresa_id, seccion_id, nombre, abreviatura, responsable, descripcion, estado_id
       FROM cargos
       WHERE seccion_id = ? AND empresa_id = ? AND estado_id = 1
       ORDER BY cargo_id DESC
       LIMIT ? OFFSET ?`,
      [seccionId, empresaId, perPage, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM cargos WHERE seccion_id = ? AND empresa_id = ? AND estado_id = 1`,
      [seccionId, empresaId]
    );

    const total = countRows[0].total || 0;
    const meta = { total, page, per_page: perPage, returned: rows.length };

    const data = await attachCargoRelations(rows, empresaId);
    const dataMeta = { total, page, per_page: perPage, returned: data.length };

    cache.set(cacheKey, { expires: now + 60000, data, meta: dataMeta });

    return res.json({ data, meta: dataMeta });
  } catch (error) {
    console.error('cargos list error:', error);
    return res.status(500).json({ error: 'Error al listar cargos' });
  }
});

// Endpoint para formularios: obtener cargos por seccion (usa empresa_id del token)
router.get('/by-seccion', async (req, res) => {
  try {
    const empresaIdRaw = req.user && req.user.empresa_id;
    const empresaId = parseInt(empresaIdRaw, 10);
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });

    const rolId = req.user && req.user.rol_id;
    const ok = await canViewCargos(rolId, empresaId);
    if (!ok) return res.status(401).json({ error: 'No autorizado' });

    const seccionIdRaw = req.query.seccion_id;
    if (!seccionIdRaw) return res.status(400).json({ error: 'seccion_id es obligatorio' });
    const seccionId = parseInt(seccionIdRaw, 10);
    if (!Number.isInteger(seccionId) || seccionId <= 0) return res.status(400).json({ error: 'seccion_id inválido' });

    const [rows] = await pool.query(
      `SELECT cargo_id, empresa_id, seccion_id, nombre, abreviatura, responsable, descripcion, estado_id
       FROM cargos
       WHERE empresa_id = ? AND seccion_id = ? AND estado_id = 1
       ORDER BY nombre ASC`,
      [empresaId, seccionId]
    );

    const data = await attachCargoRelations(rows, empresaId);
    return res.json({ data, meta: { total: data.length } });
  } catch (error) {
    console.error('cargos by-seccion error:', error);
    return res.status(500).json({ error: 'Error al listar cargos por seccion' });
  }
});

// Alias más seguro para evitar colisiones: /api/cargos/seccion/:seccionId
router.get('/seccion/:seccionId', async (req, res) => {
  try {
    const empresaIdRaw = req.user && req.user.empresa_id;
    const empresaId = parseInt(empresaIdRaw, 10);
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });

    const rolId = req.user && req.user.rol_id;
    const ok = await canViewCargos(rolId, empresaId);
    if (!ok) return res.status(401).json({ error: 'No autorizado' });

    const seccionId = parseInt(req.params.seccionId, 10);
    if (!Number.isInteger(seccionId) || seccionId <= 0) return res.status(400).json({ error: 'seccion_id inválido' });

    const [rows] = await pool.query(
      `SELECT cargo_id, empresa_id, seccion_id, nombre, abreviatura, responsable, descripcion, estado_id
       FROM cargos
       WHERE empresa_id = ? AND seccion_id = ? AND estado_id = 1
       ORDER BY nombre ASC`,
      [empresaId, seccionId]
    );

    const data = await attachCargoRelations(rows, empresaId);
    return res.json({ data, meta: { total: data.length } });
  } catch (error) {
    console.error('cargos by-seccion (param) error:', error);
    return res.status(500).json({ error: 'Error al listar cargos por seccion' });
  }
});

router.get('/:id', async (req, res) => {
  const empresaId = req.user?.empresa_id;
  const rolId = req.user?.rol_id;
  const ok = await canViewCargos(rolId, empresaId);
  if (!ok) return res.status(401).json({ error: 'No autorizado' });

  const [rows] = await pool.query(
    `SELECT cargo_id, empresa_id, seccion_id, nombre, abreviatura, responsable, descripcion, estado_id
     FROM cargos
     WHERE cargo_id = ? AND empresa_id = ?
     LIMIT 1`,
    [req.params.id, empresaId]
  );

  if (!rows.length) return res.status(404).json({ message: 'Registro no encontrado' });

  const [data] = await attachCargoRelations(rows, empresaId);
  return res.json(data);
});

router.post('/', async (req, res) => {
  const empresaId = req.user?.empresa_id;
  const rolId = req.user?.rol_id;
  const ok = await canAddCargos(rolId, empresaId);
  if (!ok) return res.status(403).json({ error: 'No autorizado' });
  const response = await controller.create(req, res);
  return response;
});

router.put('/:id', async (req, res) => {
  const empresaId = req.user?.empresa_id;
  const rolId = req.user?.rol_id;
  const ok = await canEditCargos(rolId, empresaId);
  if (!ok) return res.status(403).json({ error: 'No autorizado' });
  const response = await controller.update(req, res);
  return response;
});

router.delete('/:id', async (req, res) => {
  const empresaId = req.user?.empresa_id;
  const rolId = req.user?.rol_id;
  const cargoId = Number(req.params.id);
  const ok = await canDeleteCargos(rolId, empresaId);
  if (!ok) return res.status(403).json({ error: 'No autorizado' });

  if (!Number.isInteger(cargoId) || cargoId <= 0) {
    return res.status(400).json({ error: 'cargo_id inválido' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [cargoRows] = await connection.query(
      `SELECT cargo_id, nombre
       FROM cargos
       WHERE cargo_id = ? AND empresa_id = ?
       LIMIT 1`,
      [cargoId, empresaId]
    );

    await connection.query(
      `UPDATE empleados
       SET cargo_id = NULL
       WHERE cargo_id = ?`,
      [cargoId]
    );

    if (cargoRows.length) {
      await connection.query(
        `DELETE FROM cargos
         WHERE cargo_id = ? AND empresa_id = ?`,
        [cargoId, empresaId]
      );
    }

    await connection.commit();

    return res.status(200).json({
      ok: true,
      message: cargoRows.length
        ? `El cargo "${cargoRows[0].nombre}" fue eliminado y se liberó de los empleados asociados.`
        : 'El cargo ya no existía. Se liberaron igualmente los empleados asociados si los hubiera.',
      cargo_id: cargoId,
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

export default router;