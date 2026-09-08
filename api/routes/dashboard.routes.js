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

function calcularEdadPromedio(rows) {
  const edades = rows
    .map((row) => {
      if (!row.fecha_nacimiento) return null;
      const fecha = new Date(row.fecha_nacimiento);
      if (Number.isNaN(fecha.getTime())) return null;
      const hoy = new Date();
      let edad = hoy.getFullYear() - fecha.getFullYear();
      const mesDiff = hoy.getMonth() - fecha.getMonth();
      if (mesDiff < 0 || (mesDiff === 0 && hoy.getDate() < fecha.getDate())) {
        edad -= 1;
      }
      return edad >= 0 ? edad : null;
    })
    .filter((edad) => Number.isFinite(edad));

  if (!edades.length) return null;
  const promedio = edades.reduce((acc, edad) => acc + edad, 0) / edades.length;
  return Number(promedio.toFixed(1));
}

router.get('/empleados/resumen', async (req, res) => {
  try {
    const empresaId = Number(req.user?.empresa_id);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return res.status(401).json({ error: 'empresa_id inválido en token' });
    }

    const [rows] = await pool.query(
      `SELECT e.empleado_id, e.estado, e.sexo, e.fecha_nacimiento, e.seccion_id,
              COALESCE(s.nombre, 'Sin sección') AS seccion_nombre,
              COALESCE(s.seccion_id, e.seccion_id) AS seccion_id_ref
       FROM empleados e
       LEFT JOIN secciones s ON s.seccion_id = e.seccion_id
       WHERE e.empresa_id = ?
       ORDER BY e.apellido ASC, e.nombre ASC`,
      [empresaId]
    );

    const total = rows.length;
    const activos = rows.filter((row) => Number(row.estado) === 1).length;
    const inactivos = total - activos;
    const hombres = rows.filter((row) => String(row.sexo || '').toUpperCase().startsWith('M')).length;
    const mujeres = rows.filter((row) => String(row.sexo || '').toUpperCase().startsWith('F')).length;
    const promedioEdad = calcularEdadPromedio(rows);

    const porSeccionMap = new Map();
    for (const row of rows) {
      const key = String(row.seccion_id_ref ?? '0');
      const nombre = row.seccion_nombre || 'Sin sección';
      if (!porSeccionMap.has(key)) {
        porSeccionMap.set(key, { seccion_id: row.seccion_id_ref ?? null, nombre, total: 0 });
      }
      porSeccionMap.get(key).total += 1;
    }

    const porSeccion = Array.from(porSeccionMap.values()).sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));

    const porGenero = [
      { codigo: 'M', nombre: 'Hombres', total: hombres },
      { codigo: 'F', nombre: 'Mujeres', total: mujeres },
    ];

    const porEstado = [
      { codigo: 'ACTIVO', nombre: 'Activos', total: activos },
      { codigo: 'INACTIVO', nombre: 'Inactivos', total: inactivos },
    ];

    return res.json({
      resumen: {
        total,
        activos,
        inactivos,
        hombres,
        mujeres,
        promedio_edad: promedioEdad,
      },
      por_estado: porEstado,
      por_genero: porGenero,
      por_seccion: porSeccion,
      meta: {
        empresa_id: empresaId,
        total_registros: total,
      },
    });
  } catch (error) {
    console.error('dashboard empleados resumen error:', error);
    return res.status(500).json({ error: 'Error al obtener resumen de empleados' });
  }
});

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
