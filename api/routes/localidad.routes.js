import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import pool from '../db.js';

const router = Router();
router.use(authenticateToken);

async function hasColumn(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return rows[0].cnt > 0;
}

let hasCodigoPostal = false;

router.get('/search', async (req, res) => {
  try {
    const term = String(req.query.q ?? '').trim();
    if (!term) {
      return res.status(400).json({ error: 'q es obligatorio' });
    }

    if (!hasCodigoPostal) {
      hasCodigoPostal = await hasColumn('localidad', 'codigoPostal');
    }

    const like = `%${term}%`;
    const params = [like];
    let sql = `SELECT id AS localidad_id, nombre${hasCodigoPostal ? ', codigoPostal AS codigo_postal' : ''}
               FROM localidad
               WHERE nombre LIKE ?`;

    if (hasCodigoPostal) {
      sql += ' OR codigoPostal LIKE ?';
      params.push(like);
    }

    sql += ' ORDER BY nombre ASC LIMIT 50';

    const [rows] = await pool.query(sql, params);
    return res.json({ data: rows, meta: { total: rows.length, query: term } });
  } catch (error) {
    console.error('localidad search error:', error);
    return res.status(500).json({ error: 'Error al buscar localidad' });
  }
});

export default router;