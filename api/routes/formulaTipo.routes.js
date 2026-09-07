import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';
import formulaTipoModel from '../models/formulaTipo.model.js';
import pool from '../db.js';

const controller = createCrudController({
  table: 'formula_tipos',
  pk: 'formula_tipo_id',
  columns: formulaTipoModel.columns,
  companyScoped: true,
  listOrderBy: 'COALESCE(empresa_id, 0) ASC, orden ASC, codigo ASC, formula_tipo_id ASC',
  nullableColumns: ['empresa_id', 'descripcion', 'actualizado_en'],
});

const router = Router();
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const [rows] = await pool.query(
      `SELECT ft.formula_tipo_id, ft.empresa_id, ft.codigo, ft.nombre, ft.descripcion, ft.activo, ft.orden, ft.creado_en, ft.actualizado_en
       FROM formula_tipos ft
       WHERE ft.empresa_id IS NULL OR ft.empresa_id = ?
       ORDER BY CASE WHEN ft.empresa_id = ? THEN 0 ELSE 1 END, ft.orden ASC, ft.codigo ASC, ft.formula_tipo_id ASC`,
      [empresaId, empresaId]
    );

    return res.json({ data: rows, meta: { total: rows.length, returned: rows.length } });
  } catch (error) {
    console.error('formula_tipos list error:', error);
    return res.status(500).json({ error: 'Error al listar tipos de fórmula' });
  }
});

router.get('/all', async (req, res) => controller.list(req, res));
router.get('/:id', (req, res) => controller.getById(req, res));
router.post('/', (req, res) => controller.create(req, res));
router.put('/:id', (req, res) => controller.update(req, res));
router.delete('/:id', (req, res) => controller.remove(req, res));

export default router;