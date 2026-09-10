import jwt from 'jsonwebtoken';
import { sendError } from '../utils/response.util.js';

export function authenticateToken(req, res, next) {
  if (req.method === 'OPTIONS') {
    return next();
  }
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return sendError(res, 401, 'Token requerido', null);
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (error) {
    return sendError(res, 401, 'Token inválido o expirado', error.message);
  }
}