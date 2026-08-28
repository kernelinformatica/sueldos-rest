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
    return res.json({ data: rows, meta: { total: rows.length } });
  } catch (error) {
    console.error('cargos all error:', error);
    return res.status(500).json({ error: 'Error al listar todos los cargos' });
  }
});

router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;

    const ok = await hasVerCatalogoPermission(rolId, empresaId);
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

    cache.set(cacheKey, { expires: now + 60000, data: rows, meta });

    return res.json({ data: rows, meta });
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

    return res.json({ data: rows, meta: { total: rows.length } });
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

    const seccionId = parseInt(req.params.seccionId, 10);
    if (!Number.isInteger(seccionId) || seccionId <= 0) return res.status(400).json({ error: 'seccion_id inválido' });

    const [rows] = await pool.query(
      `SELECT cargo_id, empresa_id, seccion_id, nombre, abreviatura, responsable, descripcion, estado_id
       FROM cargos
       WHERE empresa_id = ? AND seccion_id = ? AND estado_id = 1
       ORDER BY nombre ASC`,
      [empresaId, seccionId]
    );

    return res.json({ data: rows, meta: { total: rows.length } });
  } catch (error) {
    console.error('cargos by-seccion (param) error:', error);
    return res.status(500).json({ error: 'Error al listar cargos por seccion' });
  }
});

router.get('/:id', controller.getById);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

export default router;