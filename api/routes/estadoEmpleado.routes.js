import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';

const controller = createCrudController({
  table: 'estados_empleados',
  pk: 'estado_id',
  listOrderBy: 'estado_id ASC',
});

const router = Router();
router.use(authenticateToken);
router.get('/', controller.list);
router.get('/:id', controller.getById);

export default router;