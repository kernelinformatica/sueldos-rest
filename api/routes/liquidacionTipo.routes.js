import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';

const controller = createCrudController({
  table: 'liquidacion_tipo',
  pk: 'liquidacion_tipo_id',
  companyScoped: true,
  listOrderBy: 'orden ASC, nombre ASC, liquidacion_tipo_id ASC',
});

const router = Router();
router.use(authenticateToken);

router.get('/', async (req, res) => {
  const empresaId = Number(req.user?.empresa_id);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
  return controller.list(req, res);
});

router.get('/all', async (req, res) => {
  const empresaId = Number(req.user?.empresa_id);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
  return controller.list(req, res);
});

router.get('/:id', async (req, res) => {
  const empresaId = Number(req.user?.empresa_id);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
  return controller.getById(req, res);
});

router.post('/', async (req, res) => {
  const empresaId = Number(req.user?.empresa_id);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
  return controller.create(req, res);
});

router.put('/:id', async (req, res) => {
  const empresaId = Number(req.user?.empresa_id);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
  return controller.update(req, res);
});

router.delete('/:id', async (req, res) => {
  const empresaId = Number(req.user?.empresa_id);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
  return controller.remove(req, res);
});

export default router;
