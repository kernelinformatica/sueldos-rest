import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import pool from '../db.js';

const cache = new Map(); // simple in-memory cache: key -> { expires, data }

async function hasVerCatalogoPermission(rolId, empresaId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM rolPermiso rp
     INNER JOIN permiso p ON p.id = rp.permisoId
     WHERE rp.rolId = ? AND rp.empresa_id = ? AND p.alias = 'ver_catalogo' AND rp.estado = 1 AND p.estado = 1`,
    [rolId, empresaId]
  );
  return rows[0].cnt > 0;
}

const router = Router();

router.use(authenticateToken);

// Devuelve todas las secciones de la empresa (sin paginación ni filtros)
router.get('/all', async (req, res) => {
  try {
    const empresaIdRaw = req.user && req.user.empresa_id;
    const empresaId = parseInt(empresaIdRaw, 10);
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });
    const sucursalIdRaw = req.query.sucursal_id;
    let sucursalId = null;
    if (sucursalIdRaw !== undefined && sucursalIdRaw !== null && String(sucursalIdRaw).trim() !== '') {
      sucursalId = parseInt(sucursalIdRaw, 10);
      if (!Number.isInteger(sucursalId) || sucursalId <= 0) return res.status(400).json({ error: 'sucursal_id inválido' });
    }

    const params = [empresaId];
    let sql = `SELECT s.seccion_id, s.sucursal_id, s.nombre, s.orden, s.estado,
                    su.empresa_id AS empresa_id_ref, su.nombre AS sucursal_nombre
             FROM secciones s
             INNER JOIN sucursales su ON su.sucursal_id = s.sucursal_id
             WHERE su.empresa_id = ? AND s.estado = 1`;

    if (sucursalId) {
      sql += ' AND s.sucursal_id = ?';
      params.push(sucursalId);
    }

    sql += ' ORDER BY s.orden ASC, s.seccion_id ASC';

    const [rows] = await pool.query(sql, params);
    // devolver solamente las filas filtradas por empresa (sin exposición de envelope)
    return res.json(rows);
  } catch (error) {
    console.error('secciones all error:', error);
    return res.status(500).json({ error: 'Error al listar todas las secciones' });
  }
});

router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;

    // Authz: require permiso 'ver_catalogo'
    const ok = await hasVerCatalogoPermission(rolId, empresaId);
    if (!ok) return res.status(401).json({ error: 'No autorizado' });

    const sucursalIdRaw = req.query.sucursal_id;
    if (!sucursalIdRaw) return res.status(400).json({ error: 'sucursal_id es obligatorio' });
    const sucursalId = parseInt(sucursalIdRaw, 10);
    if (!Number.isInteger(sucursalId) || sucursalId <= 0) return res.status(400).json({ error: 'sucursal_id inválido' });

    // pagination
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const perPage = Math.min(500, Math.max(1, parseInt(req.query.per_page || '1000', 10)));
    const offset = (page - 1) * perPage;

    const cacheKey = `secciones:${sucursalId}:p${page}:pp${perPage}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > now) {
      return res.json({ data: cached.data, meta: cached.meta, cache: 'HIT' });
    }

    const [rows] = await pool.query(
      `SELECT s.seccion_id, s.sucursal_id, s.nombre, s.orden, s.estado,
              su.empresa_id AS empresa_id_ref, su.nombre AS sucursal_nombre
       FROM secciones s
       INNER JOIN sucursales su ON su.sucursal_id = s.sucursal_id
       WHERE su.empresa_id = ? AND s.sucursal_id = ? AND s.estado = 1
       ORDER BY s.seccion_id DESC
       LIMIT ? OFFSET ?`,
      [empresaId, sucursalId, perPage, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total
       FROM secciones s
       INNER JOIN sucursales su ON su.sucursal_id = s.sucursal_id
       WHERE su.empresa_id = ? AND s.sucursal_id = ? AND s.estado = 1`,
      [empresaId, sucursalId]
    );

    const total = countRows[0].total || 0;
    const meta = { total, page, per_page: perPage, returned: rows.length };

    // cache 60s
    cache.set(cacheKey, { expires: now + 60000, data: rows, meta });

    return res.json({ data: rows, meta });
  } catch (error) {
    console.error('seccion list error:', error);
    return res.status(500).json({ error: 'Error al listar secciones' });
  }
});

// Endpoint para formularios: obtener secciones de una sucursal (usa empresa_id del token)
router.get('/by-sucursal', async (req, res) => {
  try {
    const empresaIdRaw = req.user && req.user.empresa_id;
    const empresaId = parseInt(empresaIdRaw, 10);
    if (!Number.isInteger(empresaId) || empresaId <= 0) return res.status(401).json({ error: 'empresa_id inválido en token' });

    const sucursalIdRaw = req.query.sucursal_id;
    if (!sucursalIdRaw) return res.status(400).json({ error: 'sucursal_id es obligatorio' });
    const sucursalId = parseInt(sucursalIdRaw, 10);
    if (!Number.isInteger(sucursalId) || sucursalId <= 0) return res.status(400).json({ error: 'sucursal_id inválido' });

    const [rows] = await pool.query(
      `SELECT s.seccion_id, s.sucursal_id, s.nombre, s.orden, s.estado
       FROM secciones s
       INNER JOIN sucursales su ON su.sucursal_id = s.sucursal_id
       WHERE su.empresa_id = ? AND s.sucursal_id = ? AND s.estado = 1
       ORDER BY s.orden ASC, s.seccion_id ASC`,
      [empresaId, sucursalId]
    );

    return res.json({ data: rows, meta: { total: rows.length } });
  } catch (error) {
    console.error('secciones by-sucursal error:', error);
    return res.status(500).json({ error: 'Error al listar secciones por sucursal' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const [rows] = await pool.query(
      `SELECT s.seccion_id, s.sucursal_id, s.nombre, s.orden, s.estado,
              su.empresa_id AS empresa_id_ref, su.nombre AS sucursal_nombre
       FROM secciones s
       INNER JOIN sucursales su ON su.sucursal_id = s.sucursal_id
       WHERE s.seccion_id = ? AND su.empresa_id = ?
       LIMIT 1`,
      [req.params.id, empresaId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Seccion no encontrada' });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error('seccion getById error:', error);
    return res.status(500).json({ message: 'Error al obtener seccion' });
  }
});

export default router;