import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createLiquidacionService } from '../services/liquidacion.service.js';

const service = createLiquidacionService();

const router = Router();
router.use(authenticateToken);
router.get('/analitica', service.analitica);
router.get('/', service.list);
router.get('/:liquidacion_id', service.getById);
router.delete('/:liquidacion_id', service.remove);
router.post('/calcular-mensual', service.calcularMensual);
router.post('/:liquidacion_id/detalle-basico', service.generarDetalleBasico);
router.post('/:liquidacion_id/reabrir', service.reabrir);
router.post('/:liquidacion_id/anular', service.anular);
router.patch('/:liquidacion_id/estado', service.cambiarEstado);
router.put('/:liquidacion_id/estado', service.cambiarEstado);

export default router;
