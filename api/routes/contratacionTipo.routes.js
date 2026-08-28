import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';

const controller = createCrudController({
  table: 'contrataciones_tipos',
  pk: 'contrataciones_tipos_id',
  companyScoped: true,
  listOrderBy: 'contrataciones_tipos_id DESC',
});

const router = Router();
router.use(authenticateToken);
router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

export default router;