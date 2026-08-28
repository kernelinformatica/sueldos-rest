import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createLiquidacionService } from '../services/liquidacion.service.js';

const service = createLiquidacionService();

const router = Router();
router.use(authenticateToken);
router.get('/', service.list);
router.post('/calcular-mensual', service.calcularMensual);
router.post('/:liquidacion_id/detalle-basico', service.generarDetalleBasico);

export default router;
