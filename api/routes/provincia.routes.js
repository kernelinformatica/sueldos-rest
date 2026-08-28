import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import pool from '../db.js';

const router = Router();

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const { pais_id } = req.query;
    const params = [];
    let whereSql = '';
    let paisIdFinal = pais_id;

    if (!paisIdFinal) {
      const empresaId = req.user?.empresa_id;
      if (!empresaId) {
        return res.status(400).json({ message: 'No se pudo obtener la empresa del token' });
      }

      const [empresaRows] = await pool.query(
        'SELECT pais_id FROM empresas WHERE empresa_id = ? LIMIT 1',
        [empresaId]
      );

      let derivedPais = empresaRows[0]?.pais_id ?? null;
      if (!derivedPais) {
        return res.status(404).json({ message: 'La empresa no tiene país asignado' });
      }
      // si el valor es numérico (id), convertir a código buscando en `paises`.
      if (Number.isInteger(Number(derivedPais))) {
        const [pRows] = await pool.query('SELECT codigo FROM paises WHERE pais_id = ? LIMIT 1', [derivedPais]);
        paisIdFinal = pRows[0]?.codigo ?? null;
      } else {
        paisIdFinal = derivedPais;
      }
    }

    if (paisIdFinal) {
      whereSql = 'WHERE codigoPais = ?';
      params.push(paisIdFinal);
    }

    const [rows] = await pool.query(
      `SELECT id AS provincia_id, codigoPais AS pais_id, codigoIndec AS codigo, nombre, NULL AS estado_id
       FROM provincia
       ${whereSql}
       ORDER BY nombre ASC`,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error('provincias list error:', error);
    return res.status(500).json({ message: 'Error al listar provincias' });
  }
});

router.get('/pais/:paisId', async (req, res) => {
  try {
    let { paisId } = req.params;
    // si el parámetro es numérico, convertir a código
    if (Number.isInteger(Number(paisId))) {
      const [pRows] = await pool.query('SELECT codigo FROM paises WHERE pais_id = ? LIMIT 1', [paisId]);
      paisId = pRows[0]?.codigo ?? paisId;
    }
    const [rows] = await pool.query(
      `SELECT id AS provincia_id, codigoPais AS pais_id, codigoIndec AS codigo, nombre, NULL AS estado_id
       FROM provincia
       WHERE codigoPais = ?
       ORDER BY nombre ASC`,
      [paisId]
    );

    return res.json(rows);
  } catch (error) {
    console.error('provincias by country error:', error);
    return res.status(500).json({ message: 'Error al listar provincias por país' });
  }
});

export default router;