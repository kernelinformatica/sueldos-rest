import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';

const controller = createCrudController({
  table: 'estados_liquidaciones',
  pk: 'estado_liquidacion_id',
  listOrderBy: 'estado_liquidacion_id ASC',
});

const router = Router();
router.use(authenticateToken);
router.get('/', controller.list);
router.get('/:id', controller.getById);

export default router;
