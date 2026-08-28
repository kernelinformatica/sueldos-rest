import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';

const controller = createCrudController({
  table: 'sucursales',
  pk: 'sucursal_id',
  companyScoped: true,
  listOrderBy: 'sucursal_id DESC',
});

const router = Router();
router.use(authenticateToken);
// Devuelve todas las sucursales de la empresa (sin paginación)
router.get('/all', async (req, res) => {
  try {
    const empresaIdRaw = req.user && req.user.empresa_id;
    const empresaId = parseInt(empresaIdRaw, 10);
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });

    const [rows] = await pool.query(
      `SELECT sucursal_id, cod_interno, empresa_id, nombre, direccion, principal, estado
       FROM sucursales
       WHERE empresa_id = ? AND estado = 1
       ORDER BY nombre ASC`,
      [empresaId]
    );

    return res.json({ data: rows, meta: { total: rows.length } });
  } catch (error) {
    console.error('sucursales all error:', error);
    return res.status(500).json({ error: 'Error al listar sucursales' });
  }
});
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

export default router;
