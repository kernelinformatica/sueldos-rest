import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import pool from '../db.js';
import { sendError } from '../utils/response.util.js';

const router = Router();
router.use(authenticateToken);

router.get('/search', async (req, res) => {
  try {
    const empresaId = Number(req.user?.empresa_id);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return sendError(res, 401, 'empresa_id inválido en token', null);
    }

    const term = String(req.query.q ?? req.query.query ?? req.query.search ?? '').trim();
    if (!term) {
      return sendError(res, 400, 'q es obligatorio', null);
    }

    const like = `%${term}%`;
    const [rows] = await pool.query(
      `SELECT id_os AS obra_social_id, codigo, nombre, descripcion
       FROM obras_sociales
       WHERE empresa_id = ?
         AND (codigo LIKE ? OR nombre LIKE ?)
       ORDER BY nombre ASC, codigo ASC
       LIMIT 50`,
      [empresaId, like, like]
    );

    return res.json({
      data: rows.map((row) => ({
        obra_social_id: row.obra_social_id,
        codigo: row.codigo,
        nombre: row.nombre,
        descripcion: row.descripcion,
        texto: row.codigo ? `${row.codigo} - ${row.nombre}` : row.nombre,
      })),
      meta: { total: rows.length, query: term },
    });
  } catch (error) {
    console.error('obra social search error:', error);
    return sendError(res, 500, 'Error al buscar obras sociales', error.message);
  }
});

export default router;