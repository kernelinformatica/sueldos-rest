import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import pool from '../db.js';
import { createCrudController } from '../services/crud.service.js';

const controller = createCrudController({
  table: 'sucursales',
  pk: 'sucursal_id',
  companyScoped: true,
  listOrderBy: 'nombre ASC, sucursal_id ASC',
});

const router = Router();
router.use(authenticateToken);

async function hasPermission(alias, rolId, empresaId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM rolPermiso rp
     INNER JOIN permiso p ON p.id = rp.permisoId
     WHERE rp.rolId = ? AND rp.empresa_id = ? AND p.alias = ? AND rp.estado = 1 AND p.estado = 1`,
    [rolId, empresaId, alias]
  );
  return rows[0].cnt > 0;
}

async function hasVerCatalogoPermission(rolId, empresaId) {
  return hasPermission('ver_catalogo', rolId, empresaId);
}

async function canViewSucursales(rolId, empresaId) {
  return hasPermission('sucursales', rolId, empresaId) || hasVerCatalogoPermission(rolId, empresaId);
}

async function canAddSucursales(rolId, empresaId) {
  return hasPermission('sucursales_agregar', rolId, empresaId);
}

async function canEditSucursales(rolId, empresaId) {
  return hasPermission('sucursales_editar', rolId, empresaId);
}

async function canDeleteSucursales(rolId, empresaId) {
  const borrar = await hasPermission('sucursales_borrar', rolId, empresaId);
  const eliminar = await hasPermission('sucursales_eliminar', rolId, empresaId);
  const base = await hasPermission('sucursales', rolId, empresaId);

  console.warn('canDeleteSucursales check', {
    rolId,
    empresaId,
    borrar,
    eliminar,
    base,
  });

  return borrar || eliminar || base;
}

async function canRelateSecciones(rolId, empresaId) {
  return hasPermission('sucursales_relacionar', rolId, empresaId);
}

async function attachSecciones(rows, empresaId) {
  if (!rows.length) return rows;

  const sucursalIds = rows.map((row) => row.sucursal_id);
  const placeholders = sucursalIds.map(() => '?').join(',');
  const [secciones] = await pool.query(
    `SELECT s.seccion_id, s.sucursal_id, s.nombre, s.orden, s.estado AS estado_id
     FROM secciones s
     INNER JOIN sucursales su ON su.sucursal_id = s.sucursal_id
     WHERE su.empresa_id = ? AND s.sucursal_id IN (${placeholders})
     ORDER BY s.orden ASC, s.nombre ASC, s.seccion_id ASC`,
    [empresaId, ...sucursalIds]
  );

  const seccionesPorSucursal = secciones.reduce((acc, seccion) => {
    if (!acc[seccion.sucursal_id]) acc[seccion.sucursal_id] = [];
    acc[seccion.sucursal_id].push(seccion);
    return acc;
  }, {});

  return rows.map((row) => ({
    ...row,
    secciones: seccionesPorSucursal[row.sucursal_id] || [],
  }));
}

async function attachLocalidadAndRespSucursal(rows) {
  if (!rows.length) return rows;

  const localidadIds = [...new Set(rows.map((row) => row.localidad_id).filter((value) => value !== null && value !== undefined))];
  const respSucursalIds = [...new Set(rows.map((row) => row.resp_sucursal).filter((value) => value !== null && value !== undefined))];

  let localidadesById = new Map();
  if (localidadIds.length) {
    const localidadPlaceholders = localidadIds.map(() => '?').join(',');
    const [localidadRows] = await pool.query(
      `SELECT id AS localidad_id, nombre, codigoPostal AS codigo_postal
       FROM localidad
       WHERE id IN (${localidadPlaceholders})`,
      localidadIds
    );
    localidadesById = new Map(localidadRows.map((row) => [String(row.localidad_id), { localidad_id: row.localidad_id, nombre: row.nombre }]));
  }

  let empleadosById = new Map();
  if (respSucursalIds.length) {
    const empleadoPlaceholders = respSucursalIds.map(() => '?').join(',');
    const [empleadoRows] = await pool.query(
      `SELECT empleado_id, legajo, nombre, apellido, estado
       FROM empleados
       WHERE empleado_id IN (${empleadoPlaceholders})`,
      respSucursalIds
    );
    empleadosById = new Map(empleadoRows.map((row) => [String(row.empleado_id), {
      empleado_id: row.empleado_id,
      legajo: row.legajo,
      nombre: row.nombre,
      apellido: row.apellido,
      estado: row.estado,
    }]));
  }

  return rows.map((row) => ({
    ...row,
    localidad: row.localidad_id ? (localidadesById.get(String(row.localidad_id)) || {}) : {},
    resp_sucursal: row.resp_sucursal ? (empleadosById.get(String(row.resp_sucursal)) || {}) : {},
  }));
}

function normalizeSectionIds(payload) {
  const raw = payload?.seccion_ids ?? payload?.seccion_id ?? payload?.secciones ?? payload?.seccionIds;
  const values = Array.isArray(raw) ? raw : (raw !== undefined && raw !== null ? [raw] : []);
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function normalizeSucursalPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  if (payload.localidad_id !== undefined) {
    const localidadId = Number(payload.localidad_id);
    payload.localidad_id = Number.isInteger(localidadId) && localidadId > 0 ? localidadId : null;
  }

  return payload;
}

router.get('/', async (req, res) => {
  try {
    const empresaId = req.user?.empresa_id;
    const rolId = req.user?.rol_id;
    if (!Number.isInteger(Number(empresaId)) || Number(empresaId) <= 0) {
      return res.status(401).json({ error: 'empresa_id inválido en token' });
    }
    const ok = await canViewSucursales(rolId, empresaId);
    if (!ok) return res.status(403).json({ error: 'No autorizado' });

    const [rows] = await pool.query(
      `SELECT sucursal_id, cod_interno, empresa_id, nombre, direccion, localidad_id, latitud, longitud, resp_sucursal, principal, estado, orden
       FROM sucursales
       WHERE empresa_id = ?
       ORDER BY orden ASC, nombre ASC, sucursal_id ASC`,
      [empresaId]
    );

    const withRelations = await attachLocalidadAndRespSucursal(rows);
    const data = await attachSecciones(withRelations, empresaId);
    return res.json(data);
  } catch (error) {
    console.error('sucursales list error:', error);
    return res.status(500).json({ error: 'Error al listar sucursales' });
  }
});

router.get('/all', async (req, res) => {
  try {
    const empresaId = Number(req.user?.empresa_id);
    const rolId = req.user?.rol_id;
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
    const ok = await canViewSucursales(rolId, empresaId);
    if (!ok) return res.status(403).json({ error: 'No autorizado' });

    const [rows] = await pool.query(
      `SELECT sucursal_id, cod_interno, empresa_id, nombre, direccion, localidad_id, latitud, longitud, resp_sucursal, principal, estado, orden
       FROM sucursales
       WHERE empresa_id = ?
       ORDER BY orden ASC, nombre ASC, sucursal_id ASC`,
      [empresaId]
    );

    const withRelations = await attachLocalidadAndRespSucursal(rows);
    const data = await attachSecciones(withRelations, empresaId);
    return res.json({ data, meta: { total: data.length } });
  } catch (error) {
    console.error('sucursales all error:', error);
    return res.status(500).json({ error: 'Error al listar sucursales' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const empresaId = Number(req.user?.empresa_id);
    const rolId = req.user?.rol_id;
    const sucursalId = Number(req.params.id);
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
    if (!Number.isInteger(sucursalId) || sucursalId <= 0) return res.status(400).json({ error: 'sucursal_id inválido' });
    const ok = await canViewSucursales(rolId, empresaId);
    if (!ok) return res.status(403).json({ error: 'No autorizado' });

    const [rows] = await pool.query(
      `SELECT sucursal_id, cod_interno, empresa_id, nombre, direccion, localidad_id, latitud, longitud, resp_sucursal, principal, estado, orden
       FROM sucursales
       WHERE sucursal_id = ? AND empresa_id = ?
       LIMIT 1`,
      [sucursalId, empresaId]
    );

    if (!rows.length) return res.status(404).json({ message: 'Registro no encontrado' });

    const withRelations = await attachLocalidadAndRespSucursal(rows);
    const [withSections] = await attachSecciones(withRelations, empresaId);
    return res.json(withSections);
  } catch (error) {
    console.error('sucursales getById error:', error);
    return res.status(500).json({ message: 'Error al obtener sucursal' });
  }
});
router.post('/', async (req, res, next) => {
  try {
    const empresaId = Number(req.user?.empresa_id);
    const rolId = req.user?.rol_id;
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
    const ok = await canAddSucursales(rolId, empresaId);
    if (!ok) return res.status(403).json({ error: 'No autorizado' });
    normalizeSucursalPayload(req.body);
    return controller.create(req, res, next);
  } catch (error) {
    return res.status(500).json({ error: 'Error al crear sucursal' });
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const empresaId = Number(req.user?.empresa_id);
    const rolId = req.user?.rol_id;
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
    const ok = await canEditSucursales(rolId, empresaId);
    if (!ok) return res.status(403).json({ error: 'No autorizado' });
    normalizeSucursalPayload(req.body);
    return controller.update(req, res, next);
  } catch (error) {
    return res.status(500).json({ error: 'Error al actualizar sucursal' });
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const empresaId = Number(req.user?.empresa_id);
    const rolId = req.user?.rol_id;
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
    const ok = await canDeleteSucursales(rolId, empresaId);
    if (!ok) {
      console.warn('DELETE /api/sucursales denied', {
        sucursal_id: req.params.id,
        empresa_id: req.user?.empresa_id,
        rol_id: req.user?.rol_id,
        usuario_id: req.user?.usuario_id,
      });
      return res.status(403).json({ error: 'No autorizado' });
    }
    return controller.remove(req, res, next);
  } catch (error) {
    return res.status(500).json({ error: 'Error al eliminar sucursal' });
  }
});

router.post('/:id/relacionar-secciones', async (req, res) => {
  try {
    const empresaId = Number(req.user?.empresa_id);
    const rolId = req.user?.rol_id;
    const sucursalId = Number(req.params.id);
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
    if (!Number.isInteger(sucursalId) || sucursalId <= 0) return res.status(400).json({ error: 'sucursal_id inválido' });

    const ok = await canRelateSecciones(rolId, empresaId);
    if (!ok) return res.status(403).json({ error: 'No autorizado' });

    const [sucursalRows] = await pool.query(
      `SELECT sucursal_id, cod_interno, empresa_id, nombre, direccion, localidad_id, latitud, longitud, resp_sucursal, principal, estado, orden
       FROM sucursales
       WHERE sucursal_id = ? AND empresa_id = ?
       LIMIT 1`,
      [sucursalId, empresaId]
    );
    if (!sucursalRows.length) return res.status(404).json({ error: 'Sucursal no encontrada' });

    const sectionIds = normalizeSectionIds(req.body);
    if (!sectionIds.length) {
      return res.status(400).json({ error: 'Debe enviar al menos una seccion_id' });
    }

    const placeholders = sectionIds.map(() => '?').join(',');
    const [sectionRows] = await pool.query(
      `SELECT s.seccion_id
       FROM secciones s
       INNER JOIN sucursales su ON su.sucursal_id = s.sucursal_id
       WHERE su.empresa_id = ? AND s.seccion_id IN (${placeholders})`,
      [empresaId, ...sectionIds]
    );

    if (sectionRows.length !== sectionIds.length) {
      return res.status(400).json({ error: 'Una o más secciones no pertenecen a la empresa o no existen' });
    }

    await pool.query(
      `UPDATE secciones
       SET sucursal_id = ?
       WHERE seccion_id IN (${placeholders})`,
      [sucursalId, ...sectionIds]
    );

    const [updatedRows] = await pool.query(
      `SELECT sucursal_id, cod_interno, empresa_id, nombre, direccion, localidad_id, latitud, longitud, resp_sucursal, principal, estado, orden
       FROM sucursales
       WHERE sucursal_id = ? AND empresa_id = ?
       LIMIT 1`,
      [sucursalId, empresaId]
    );

    const withRelations = await attachLocalidadAndRespSucursal(updatedRows);
    const data = await attachSecciones(withRelations, empresaId);
    return res.json({
      message: 'Secciones relacionadas correctamente',
      data,
      updatedSections: sectionIds.length,
    });
  } catch (error) {
    console.error('sucursales relacionar secciones error:', error);
    return res.status(500).json({ error: 'Error al relacionar secciones a la sucursal' });
  }
});

export default router;
