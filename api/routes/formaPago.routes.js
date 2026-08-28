import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';

const controller = createCrudController({
  table: 'formas_pago',
  pk: 'forma_pago_id',
  companyScoped: true,
  listOrderBy: 'forma_pago_id DESC',
});

const router = Router();
router.use(authenticateToken);
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

export default router;