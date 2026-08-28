import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';
import pool from '../db.js';

const controller = createCrudController({
  table: 'convenios',
  pk: 'convenio_id',
  companyScoped: true,
  listOrderBy: 'convenio_id DESC',
});

const router = Router();
router.use(authenticateToken);

// List convenios with optional filters: empresa_id, q, active_only, pagination
router.get('/', async (req, res) => {
  try {
    const userEmpresa = req.user?.empresa_id;
    const empresaId = req.query.empresa_id ? Number(req.query.empresa_id) : userEmpresa;
    const q = req.query.q ? String(req.query.q).trim() : null;
    const activeOnly = req.query.active_only === undefined ? true : String(req.query.active_only) !== '0' && String(req.query.active_only) !== 'false';
    const page = req.query.page ? Math.max(1, Number(req.query.page)) : null;
    const perPage = req.query.per_page ? Math.max(1, Number(req.query.per_page)) : null;

    const filters = [];
    const params = [];
    if (empresaId) {
      filters.push('empresa_id = ?');
      params.push(empresaId);
    }
    if (q) {
      filters.push('nombre LIKE ?');
      params.push(`%${q}%`);
    }
    if (activeOnly) {
      filters.push('estado_id = 1');
    }

    let sql = `SELECT convenio_id, convenio_id AS id, nombre, descripcion, estado_id AS activo FROM convenios`;
    if (filters.length) sql += ` WHERE ` + filters.join(' AND ');
    sql += ' ORDER BY convenio_id DESC';

    if (page && perPage) {
      const offset = (page - 1) * perPage;
      sql += ` LIMIT ${perPage} OFFSET ${offset}`;
    }

    const [rows] = await pool.query(sql, params);

    res.set('Cache-Control', 'public, max-age=300');
    return res.json({ data: rows });
  } catch (error) {
    console.error('convenios list error:', error);
    return res.status(500).json({ message: 'Error al listar convenios' });
  }
});

// Get categories for a convenio
router.get('/:id/categorias', async (req, res) => {
  try {
    const { id } = req.params;
    const userEmpresa = req.user?.empresa_id;
    const empresaId = req.query.empresa_id ? Number(req.query.empresa_id) : userEmpresa;
    const q = req.query.q ? String(req.query.q).trim() : null;
    const activeOnly = req.query.active_only === undefined ? true : String(req.query.active_only) !== '0' && String(req.query.active_only) !== 'false';

    // verify convenio exists and belongs to empresa (if empresa provided)
    const [convRows] = await pool.query('SELECT convenio_id, empresa_id FROM convenios WHERE convenio_id = ? LIMIT 1', [id]);
    if (!convRows.length) return res.status(404).json({ message: 'Convenio no encontrado' });
    if (empresaId && convRows[0].empresa_id !== empresaId) {
      // If filter by empresa_id but convenio doesn't belong, return empty list
      return res.status(404).json({ message: 'Convenio no encontrado para la empresa indicada' });
    }

    const filters = ['cc.convenio_id = ?'];
    const params = [id];
    if (empresaId) {
      filters.push('cc.empresa_id = ?');
      params.push(empresaId);
    }
    if (q) {
      filters.push('cc.nombre LIKE ?');
      params.push(`%${q}%`);
    }
    if (activeOnly) {
      filters.push('cc.estado_id = 1');
    }

    const sql = `SELECT cc.categoria_id, cc.categoria_id AS id, cc.nombre, cc.codigo, cc.sueldo_basico AS sueldo_min, NULL AS sueldo_max, 0 AS orden, cc.estado_id AS activo
                 FROM convenios_categorias cc
                 WHERE ${filters.join(' AND ')}
                 ORDER BY cc.categoria_id ASC`;

    const [rows] = await pool.query(sql, params);
    res.set('Cache-Control', 'public, max-age=300');
    return res.json({ data: rows });
  } catch (error) {
    console.error('convenio categorias error:', error);
    return res.status(500).json({ message: 'Error al listar categorias' });
  }
});

// keep existing CRUD for single convenio
router.get('/:id', controller.getById);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

export default router;
