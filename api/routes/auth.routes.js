import { Router } from 'express';
import { login, register, me } from '../services/auth.service.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/login', login);
router.post('/register', register);
router.get('/me', authenticateToken, me);

export default router;