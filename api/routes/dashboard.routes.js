import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import pool from '../db.js';

const router = Router();
router.use(authenticateToken);

async function safeCount(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return Number(rows?.[0]?.total ?? rows?.[0]?.count ?? 0) || 0;
  } catch (error) {
    console.error('dashboard count error:', error.message || error);
    return 0;
  }
}

async function safeEmployeeStates(empresaId) {
  try {
    const [rows] = await pool.query(
      `SELECT ee.estado_id, ee.nombre, COUNT(e.empleado_id) AS total
       FROM estados_empleados ee
       LEFT JOIN empleados e ON e.estado = ee.estado_id AND e.empresa_id = ?
       GROUP BY ee.estado_id, ee.nombre
       ORDER BY ee.estado_id ASC`,
      [empresaId]
    );

    return rows.reduce((acc, row) => {
      acc[String(row.estado_id)] = {
        label: row.nombre || 'PLANTEL',
        count: Number(row.total) || 0,
      };
      return acc;
    }, {});
  } catch (error) {
    console.error('dashboard employee states error:', error.message || error);
    return {};
  }
}

router.get('/modulos', async (req, res) => {
  try {
    const empresaId = Number(req.user?.empresa_id);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return res.status(401).json({ error: 'empresa_id inválido en token' });
    }

    const results = await Promise.allSettled([
      safeCount('SELECT COUNT(*) AS total FROM empleados WHERE empresa_id = ?', [empresaId]),
      safeCount('SELECT COUNT(*) AS total FROM cargos WHERE empresa_id = ?', [empresaId]),
      safeCount('SELECT COUNT(*) AS total FROM secciones s INNER JOIN sucursales su ON su.sucursal_id = s.sucursal_id WHERE su.empresa_id = ?', [empresaId]),
      safeCount('SELECT COUNT(*) AS total FROM sucursales WHERE empresa_id = ?', [empresaId]),
      safeCount('SELECT COUNT(*) AS total FROM conceptos WHERE empresa_id = ?', [empresaId]),
    ]);

    const counts = results.map((result) => (result.status === 'fulfilled' ? result.value : 0));
    const employeeStates = await safeEmployeeStates(empresaId);

    const response = {
      empleados: { label: 'PLANTEL', count: counts[0], estados: employeeStates },
      cargos: { label: 'CANTIDAD', count: counts[1] },
      secciones: { label: 'CANTIDAD', count: counts[2] },
      sucursales: { label: 'CANTIDAD', count: counts[3] },
      conceptos: { label: 'CANTIDAD', count: counts[4] },
    };

    return res.json(response);
  } catch (error) {
    console.error('dashboard modulos error:', error);
    return res.status(500).json({ error: 'Error al obtener conteos de módulos' });
  }
});

export default router;
