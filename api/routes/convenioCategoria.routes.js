import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';

const controller = createCrudController({
  table: 'convenios_categorias',
  pk: 'categoria_id',
  companyScoped: true,
  listOrderBy: 'categoria_id DESC',
});

const router = Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const empresaId = Number(req.user?.empresa_id);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
  return controller.list(req, res);
});

router.get('/all', (req, res) => {
  const empresaId = Number(req.user?.empresa_id);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
  return controller.list(req, res);
});

router.get('/:id', (req, res) => {
  const empresaId = Number(req.user?.empresa_id);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
  return controller.getById(req, res);
});

router.post('/', (req, res) => {
  const empresaId = Number(req.user?.empresa_id);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
  return controller.create(req, res);
});

router.put('/:id', (req, res) => {
  const empresaId = Number(req.user?.empresa_id);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
  return controller.update(req, res);
});

router.delete('/:id', (req, res) => {
  const empresaId = Number(req.user?.empresa_id);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
  return controller.remove(req, res);
});

export default router;
