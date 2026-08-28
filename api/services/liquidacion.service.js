import pool from '../db.js';
import { sendError } from '../utils/response.util.js';

async function getEmployeeBaseData(empresaId, periodo, fechaLiquidacion) {
  const [rows] = await pool.query(
    `SELECT e.empleado_id, e.nombre, e.apellido, e.forma_pago_id,
            cb.banco_id, cb.cbu, cb.alias_cbu, cc.sueldo_basico, cc.valor_hora, cc.valor_dia, cc.categoria_id,
            cc.nombre AS categoria_nombre, cv.convenio_id, cv.nombre AS convenio_nombre
     FROM empleados e
     LEFT JOIN convenios_categorias cc ON cc.categoria_id = e.convenio_categoria_id
     LEFT JOIN convenios cv ON cv.convenio_id = cc.convenio_id
     LEFT JOIN empleados_cuentas_bancarias cb ON cb.empleado_id = e.empleado_id AND cb.principal = 1
     WHERE e.empresa_id = ? AND e.estado = 1`,
    [empresaId]
  );

  const liquidacionesMap = [];
  for (const row of rows) {
    const [conceptos] = await pool.query(
      `SELECT SUM(COALESCE(ec.importe, 0)) AS total_conceptos
       FROM empleados_conceptos ec
       INNER JOIN conceptos c ON c.concepto_id = ec.concepto_id
       WHERE ec.empleado_id = ?`,
      [row.empleado_id]
    );

    const base = Number(row.sueldo_basico || 0);
    const extras = Number(conceptos[0]?.total_conceptos || 0);
    liquidacionesMap.push({
      empleado_id: row.empleado_id,
      empresa_id: empresaId,
      periodo,
      fecha_liquidacion: fechaLiquidacion,
      total: base + extras,
      forma_pago_id: row.forma_pago_id,
      banco_pago_id: row.banco_id || null,
      cbu_pago: row.cbu || null,
      estado: 1,
    });
  }

  return liquidacionesMap;
}

export function createLiquidacionService() {
  return {
    async list(req, res) {
      try {
        const empresaId = req.user.empresa_id;
        const { periodo } = req.query;
        const filters = ['l.empresa_id = ?'];
        const params = [empresaId];
        if (periodo) {
          filters.push('l.periodo = ?');
          params.push(periodo);
        }
        const [rows] = await pool.query(
          `SELECT l.*, e.nombre AS empleado_nombre, e.apellido AS empleado_apellido
           FROM liquidaciones l
           INNER JOIN empleados e ON e.empleado_id = l.empleado_id
           WHERE ${filters.join(' AND ')}
           ORDER BY l.liquidacion_id DESC`,
          params
        );
        return res.json(rows);
      } catch (error) {
        console.error('liquidacion list error:', error);
        return sendError(res, 500, 'Error al listar liquidaciones', error.message);
      }
    },

    async calcularMensual(req, res) {
      const connection = await pool.getConnection();
      try {
        const empresaId = req.user.empresa_id;
        const { periodo, fecha_liquidacion } = req.body;
        if (!periodo || !fecha_liquidacion) {
          return sendError(res, 400, 'periodo y fecha_liquidacion son obligatorios', null);
        }

        await connection.beginTransaction();
        const liquidaciones = await getEmployeeBaseData(empresaId, periodo, fecha_liquidacion);

        const inserted = [];
        for (const item of liquidaciones) {
          const [existing] = await connection.query(
            'SELECT liquidacion_id FROM liquidaciones WHERE empresa_id = ? AND empleado_id = ? AND periodo = ? LIMIT 1',
            [empresaId, item.empleado_id, periodo]
          );
          if (existing.length) continue;

          const [result] = await connection.query(
            `INSERT INTO liquidaciones (empleado_id, empresa_id, periodo, fecha_liquidacion, total, forma_pago_id, cbu_pago, banco_pago_id, estado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [item.empleado_id, item.empresa_id, item.periodo, item.fecha_liquidacion, item.total, item.forma_pago_id, item.cbu_pago, item.banco_pago_id, item.estado]
          );

          inserted.push(result.insertId);
        }

        await connection.commit();
        return res.status(201).json({ message: 'Liquidaciones calculadas', insertadas: inserted.length, ids: inserted });
      } catch (error) {
        await connection.rollback();
        console.error('liquidacion calcular error:', error);
        return sendError(res, 500, 'Error al calcular liquidaciones', error.message);
      } finally {
        connection.release();
      }
    },

    async generarDetalleBasico(req, res) {
      try {
        const empresaId = req.user.empresa_id;
        const { liquidacion_id } = req.params;
        const [rows] = await pool.query('SELECT * FROM liquidaciones WHERE liquidacion_id = ? AND empresa_id = ? LIMIT 1', [liquidacion_id, empresaId]);
        if (!rows.length) return sendError(res, 404, 'Liquidacion no encontrada', null);

        const liquidacion = rows[0];
        const [conceptos] = await pool.query(
          `SELECT ec.concepto_id, ec.unidades, ec.importe, ec.nro_liquidacion, c.codigo, c.descripcion, c.suma_resta
           FROM empleados_conceptos ec
           INNER JOIN conceptos c ON c.concepto_id = ec.concepto_id
           WHERE ec.empleado_id = ?`,
          [liquidacion.empleado_id]
        );

        await pool.query('DELETE FROM liquidaciones_detalle WHERE liquidacion_id = ? AND empresa_id = ?', [liquidacion_id, empresaId]);
        for (const concepto of conceptos) {
          await pool.query(
            `INSERT INTO liquidaciones_detalle
             (empresa_id, liquidacion_id, concepto_id, codigo_concepto, nombre_concepto, cantidad, base_calculo, porcentaje, importe, descripcion)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [empresaId, liquidacion_id, concepto.concepto_id, concepto.codigo, concepto.descripcion, concepto.unidades ?? 1, null, null, concepto.importe, concepto.descripcion]
          );
        }

        return res.json({ message: 'Detalle generado', conceptos: conceptos.length });
      } catch (error) {
        console.error('liquidacion detalle error:', error);
        return sendError(res, 500, 'Error al generar detalle', error.message);
      }
    },
  };
}
