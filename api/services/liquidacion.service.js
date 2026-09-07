import pool from '../db.js';
import { sendError } from '../utils/response.util.js';
import { findTopApplicable, computeTopValue } from '../utils/topes.util.js';
import { buildLiquidacionContext, fetchConceptosDeEmpresa, fetchEmpleadosActivosPorIds } from './liquidacion/contexto.service.js';
import { ejecutarMotorLiquidacion } from './liquidacion/motor.js';

async function aplicarTopeBatch(concepto, importeOriginal, contexto) {
  const tope = await findTopApplicable(contexto.empresaId, concepto.concepto_id, concepto.grupo_id, contexto.fechaLiquidacion);
  if (!tope) {
    return { importe: importeOriginal, tope_aplicado_id: null, requiere_revision: false, advertencia: null };
  }

  const baseParaPorcentaje = contexto.baseRemunerativa || contexto.basalario || 0;
  const topeValor = computeTopValue(tope, baseParaPorcentaje);
  const tipo = String(tope.tipo);
  const excede = (tipo === 'max' && Number(importeOriginal) > topeValor) || (tipo === 'min' && Number(importeOriginal) < topeValor);

  if (!excede) {
    return { importe: importeOriginal, tope_aplicado_id: tope.tope_id, requiere_revision: false, advertencia: null };
  }

  return {
    importe: topeValor,
    tope_aplicado_id: tope.tope_id,
    requiere_revision: Boolean(tope.requiere_override),
    advertencia: `Aplicado tope ${tope.tipo_label} de ${topeValor}`,
  };
}

function calcularFechasPeriodo(fechaLiquidacion) {
  const fecha = new Date(fechaLiquidacion);
  if (Number.isNaN(fecha.getTime())) return null;
  const fechaDesde = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
  const fechaHasta = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);
  return {
    fechaDesde: fechaDesde.toISOString().slice(0, 10),
    fechaHasta: fechaHasta.toISOString().slice(0, 10),
  };
}

function parsePeriodoInput(periodo) {
  if (typeof periodo !== 'string') return null;
  const match = periodo.trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  const anio = Number(match[1]);
  const mes = Number(match[2]);
  if (!anio || mes < 1 || mes > 12) return null;

  const fechaPeriodo = new Date(anio, mes - 1, 1);
  return {
    anio,
    mes,
    periodoFecha: fechaPeriodo.toISOString().slice(0, 10),
  };
}

function formatDateOnly(value) {
  if (!value) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function formatPeriodoDisplay(value) {
  if (!value) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' })
    .format(date)
    .replace(/^./, (char) => char.toUpperCase())
    .replace(' de ', ' / ');
}

async function ensurePeriodoLiquidacion(connection, empresaId, periodoParsed, fechaLiquidacion) {
  const [periodoRows] = await connection.query(
    'SELECT periodo_id, fecha_desde, fecha_hasta FROM periodos_liquidacion WHERE empresa_id = ? AND anio = ? AND mes = ? LIMIT 1',
    [empresaId, periodoParsed.anio, periodoParsed.mes]
  );

  if (periodoRows.length) {
    return periodoRows[0];
  }

  const fechaDesde = `${periodoParsed.periodoFecha}`;
  const fechaHasta = new Date(periodoParsed.anio, periodoParsed.mes, 0).toISOString().slice(0, 10);
  const descripcion = `${periodoParsed.anio}-${String(periodoParsed.mes).padStart(2, '0')}`;

  const [insertResult] = await connection.query(
    `INSERT INTO periodos_liquidacion
     (empresa_id, anio, mes, fecha_desde, fecha_hasta, descripcion, estado_id)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [empresaId, periodoParsed.anio, periodoParsed.mes, fechaDesde, fechaHasta, descripcion]
  );

  return {
    periodo_id: insertResult.insertId,
    fecha_desde: fechaDesde,
    fecha_hasta: fechaHasta,
  };
}

async function getEstadoEdicionId(connection) {
  const [rows] = await connection.query(
    `SELECT estado_liquidacion_id
     FROM estados_liquidaciones
     WHERE LOWER(nombre) = 'edicion' OR LOWER(nombre) = 'edición'
     LIMIT 1`
  );
  return rows[0]?.estado_liquidacion_id ?? null;
}

async function getEstadoRevisionId(connection) {
  const [rows] = await connection.query(
    `SELECT estado_liquidacion_id
     FROM estados_liquidaciones
     WHERE LOWER(nombre) = 'revision' OR LOWER(nombre) = 'revisión'
     LIMIT 1`
  );
  return rows[0]?.estado_liquidacion_id ?? null;
}

async function getEstadoCerradaId(connection) {
  const [rows] = await connection.query(
    `SELECT estado_liquidacion_id
     FROM estados_liquidaciones
     WHERE LOWER(nombre) = 'cerrada'
     LIMIT 1`
  );
  return rows[0]?.estado_liquidacion_id ?? null;
}

async function getEstadoPorNombre(connection, nombre) {
  const [rows] = await connection.query(
    `SELECT estado_liquidacion_id, nombre, descripcion, es_activo
     FROM estados_liquidaciones
     WHERE LOWER(nombre) = LOWER(?)
     LIMIT 1`,
    [nombre]
  );
  return rows[0] ?? null;
}

async function getEstadoLiquidacionRows(connection, estadoIds) {
  const validIds = estadoIds.filter((id) => Number.isInteger(Number(id)));
  if (!validIds.length) return [];
  const placeholders = validIds.map(() => '?').join(', ');
  const [rows] = await connection.query(
    `SELECT estado_liquidacion_id, nombre, descripcion, es_activo
     FROM estados_liquidaciones
     WHERE estado_liquidacion_id IN (${placeholders})`,
    validIds
  );
  return rows;
}

async function getEstadoLiquidacionById(connection, estadoId) {
  const [rows] = await connection.query(
    `SELECT estado_liquidacion_id, nombre, descripcion, es_activo
     FROM estados_liquidaciones
     WHERE estado_liquidacion_id = ?
     LIMIT 1`,
    [estadoId]
  );
  return rows[0] ?? null;
}

async function getEstadoLiquidacionByNombre(connection, nombre) {
  const [rows] = await connection.query(
    `SELECT estado_liquidacion_id, nombre, descripcion, es_activo
     FROM estados_liquidaciones
     WHERE LOWER(nombre) = LOWER(?)
     LIMIT 1`,
    [nombre]
  );
  return rows[0] ?? null;
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
          const periodoParsed = parsePeriodoInput(periodo);
          if (periodoParsed) {
            filters.push('DATE_FORMAT(l.periodo, "%Y-%m") = ?');
            params.push(periodo);
          } else {
            filters.push('l.periodo = ?');
            params.push(periodo);
          }
        }

        const [rows] = await pool.query(
          `SELECT l.*, e.nombre AS empleado_nombre, e.apellido AS empleado_apellido, e.foto AS empleado_foto,
                  el.nombre AS estado_nombre, el.descripcion AS estado_descripcion, el.es_activo AS estado_es_activo
           FROM liquidaciones l
           INNER JOIN empleados e ON e.empleado_id = l.empleado_id
           LEFT JOIN estados_liquidaciones el ON el.estado_liquidacion_id = l.estado
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

    async getById(req, res) {
      try {
        const empresaId = req.user.empresa_id;
        const liquidacionId = Number(req.params.liquidacion_id);
        if (!Number.isInteger(liquidacionId) || liquidacionId <= 0) {
          return sendError(res, 400, 'liquidacion_id inválido', null);
        }

        const [cabeceraRows] = await pool.query(
          `SELECT l.liquidacion_id, l.empleado_id, l.empresa_id, l.periodo, l.periodo_id,
                  l.liquidacion_tipo_id, l.fecha_liquidacion, l.total, l.total_haberes,
                  l.total_descuentos, l.total_neto, l.total_contribuciones,
                  l.total_costo_empresa, l.forma_pago_id, l.cbu_pago, l.banco_pago_id,
                  l.estado, l.requiere_revision, l.calculado_en,
                  e.legajo, e.nombre AS empleado_nombre, e.apellido AS empleado_apellido,
                  e.foto AS empleado_foto, e.fecha_ingreso, e.fecha_egreso, e.convenio_categoria_id,
                  e.tipo_contratacion_id, e.forma_pago_id AS empleado_forma_pago_id
           FROM liquidaciones l
           INNER JOIN empleados e ON e.empleado_id = l.empleado_id
           WHERE l.empresa_id = ? AND l.liquidacion_id = ?
           LIMIT 1`,
          [empresaId, liquidacionId]
        );

        if (!cabeceraRows.length) {
          return sendError(res, 404, 'Liquidacion no encontrada', null);
        }

        const estado = await getEstadoLiquidacionById(connection, cabeceraRows[0].estado);

        const [detalleRows] = await pool.query(
          `SELECT d.*
           FROM liquidaciones_detalle d
           WHERE d.empresa_id = ? AND d.liquidacion_id = ?
           ORDER BY COALESCE(d.orden, 9999) ASC, d.liquidacion_detalle_id ASC`,
          [empresaId, liquidacionId]
        );

        return res.json({
          liquidacion_id: cabeceraRows[0].liquidacion_id,
          empleado_id: cabeceraRows[0].empleado_id,
          empresa_id: cabeceraRows[0].empresa_id,
          periodo: formatPeriodoDisplay(cabeceraRows[0].periodo),
          periodo_id: cabeceraRows[0].periodo_id,
          liquidacion_tipo_id: cabeceraRows[0].liquidacion_tipo_id,
          fecha_liquidacion: formatDateOnly(cabeceraRows[0].fecha_liquidacion),
          total: cabeceraRows[0].total,
          total_haberes: cabeceraRows[0].total_haberes,
          total_descuentos: cabeceraRows[0].total_descuentos,
          total_neto: cabeceraRows[0].total_neto,
          total_contribuciones: cabeceraRows[0].total_contribuciones,
          total_costo_empresa: cabeceraRows[0].total_costo_empresa,
          forma_pago_id: cabeceraRows[0].forma_pago_id,
          cbu_pago: cabeceraRows[0].cbu_pago,
          banco_pago_id: cabeceraRows[0].banco_pago_id,
          estado: cabeceraRows[0].estado,
          estado_objeto: estado,
          requiere_revision: cabeceraRows[0].requiere_revision,
          calculado_en: formatDateOnly(cabeceraRows[0].calculado_en),
          empleado_nombre: cabeceraRows[0].empleado_nombre,
          empleado_apellido: cabeceraRows[0].empleado_apellido,
          empleado_foto: cabeceraRows[0].empleado_foto,
          empleado: {
            empleado_id: cabeceraRows[0].empleado_id,
            legajo: cabeceraRows[0].legajo,
            nombre: cabeceraRows[0].empleado_nombre,
            apellido: cabeceraRows[0].empleado_apellido,
            foto: cabeceraRows[0].empleado_foto,
            fecha_ingreso: cabeceraRows[0].fecha_ingreso,
            fecha_egreso: cabeceraRows[0].fecha_egreso,
            convenio_categoria_id: cabeceraRows[0].convenio_categoria_id,
            tipo_contratacion_id: cabeceraRows[0].tipo_contratacion_id,
            forma_pago_id: cabeceraRows[0].empleado_forma_pago_id,
          },
          detalle: detalleRows,
        });
      } catch (error) {
        console.error('liquidacion get error:', error);
        return sendError(res, 500, 'Error al obtener liquidacion', error.message);
      }
    },

    async calcularMensual(req, res) {
      const connection = await pool.getConnection();
      try {
        const empresaId = req.user.empresa_id;
        const { periodo, fecha_liquidacion, liquidacion_tipo_id = null } = req.body;
        const empleadoIdsRaw = req.body?.empleado_ids ?? req.body?.empleado_id ?? req.body?.empleadoId ?? req.body?.empleado;
        if (!periodo || !fecha_liquidacion) {
          return sendError(res, 400, 'periodo y fecha_liquidacion son obligatorios', null);
        }

        const periodoParsed = parsePeriodoInput(periodo);
        if (!periodoParsed) {
          return sendError(res, 400, 'periodo debe tener formato YYYY-MM', null);
        }

        const fechas = calcularFechasPeriodo(fecha_liquidacion);
        if (!fechas) {
          return sendError(res, 400, 'fecha_liquidacion inválida', null);
        }
        const fechaLiquidacionDb = formatDateOnly(fecha_liquidacion);
        if (!fechaLiquidacionDb) {
          return sendError(res, 400, 'fecha_liquidacion inválida', null);
        }

        const empleadoIds = Array.isArray(empleadoIdsRaw)
          ? empleadoIdsRaw
          : empleadoIdsRaw !== undefined && empleadoIdsRaw !== null && empleadoIdsRaw !== ''
            ? [empleadoIdsRaw]
            : [];

        await connection.beginTransaction();

        const estadoEdicionId = await getEstadoEdicionId(connection);
        const estadoRevisionId = await getEstadoRevisionId(connection);
        const estadoCerradaId = await getEstadoCerradaId(connection);
        if (!estadoEdicionId || !estadoRevisionId || !estadoCerradaId) {
          await connection.rollback();
          return sendError(res, 500, 'No se pudieron resolver los estados de liquidación', null);
        }

        const empleados = empleadoIds.length
          ? await fetchEmpleadosActivosPorIds(empresaId, empleadoIds)
          : [];

        if (empleadoIds.length && !empleados.length) {
          await connection.rollback();
          return sendError(res, 400, 'No se encontraron empleados activos válidos para liquidar', null);
        }

        if (!empleadoIds.length) {
          await connection.rollback();
          return sendError(res, 400, 'empleado_ids es obligatorio y debe contener al menos un empleado', null);
        }

        const createdIds = [];
        const periodoRow = await ensurePeriodoLiquidacion(connection, empresaId, periodoParsed, fecha_liquidacion);

        for (const row of empleados) {
          const periodoId = periodoRow.periodo_id;

          const [existente] = await connection.query(
            'SELECT liquidacion_id, estado FROM liquidaciones WHERE empresa_id = ? AND empleado_id = ? AND (periodo_id = ? OR DATE_FORMAT(periodo, "%Y-%m") = ?) LIMIT 1',
            [empresaId, row.empleado_id, periodoId, periodo]
          );
          if (existente.length) {
            const estadoExistente = Number(existente[0].estado);
            if (estadoExistente === Number(estadoRevisionId) || estadoExistente === Number(estadoCerradaId)) {
              await connection.rollback();
              return sendError(
                res,
                409,
                `No se puede recalcular una liquidacion en estado ${estadoExistente === Number(estadoRevisionId) ? 'Revision' : 'Cerrada'}. Primero cambiela a Edicion.`,
                null
              );
            }

            if (estadoExistente !== Number(estadoEdicionId)) {
              continue;
            }

            await connection.query('DELETE FROM liquidaciones_detalle WHERE empresa_id = ? AND liquidacion_id = ?', [empresaId, existente[0].liquidacion_id]);
            await connection.query('DELETE FROM liquidaciones WHERE empresa_id = ? AND liquidacion_id = ?', [empresaId, existente[0].liquidacion_id]);
          }

          const contexto = await buildLiquidacionContext(empresaId, row.empleado_id, fechas.fechaDesde, fechas.fechaHasta, fecha_liquidacion);
          if (!contexto) continue;

          const { resultados, totales } = await ejecutarMotorLiquidacion(contexto, aplicarTopeBatch);
          const requiereRevision = resultados.some((item) => item.requiere_revision);

          const [insertResult] = await connection.query(
            `INSERT INTO liquidaciones
             (empleado_id, empresa_id, periodo, periodo_id, liquidacion_tipo_id, fecha_liquidacion, total, total_haberes, total_descuentos, total_neto, total_contribuciones, total_costo_empresa, forma_pago_id, cbu_pago, banco_pago_id, estado, requiere_revision, calculado_en)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
              row.empleado_id,
              empresaId,
              periodoParsed.periodoFecha,
              periodoId,
              liquidacion_tipo_id,
              fechaLiquidacionDb,
              totales.total_neto,
              totales.total_haberes,
              totales.total_descuentos,
              totales.total_neto,
              totales.total_contribuciones,
              totales.total_costo_empresa,
              contexto.empleado.forma_pago_id,
              null,
              null,
              estadoEdicionId,
              requiereRevision ? 1 : 0,
            ]
          );

          for (const detalle of resultados) {
            const cantidad = Number.isFinite(Number(detalle.cantidad ?? detalle.unidades))
              ? Number(detalle.cantidad ?? detalle.unidades)
              : 1;
            const baseCalculo = Number.isFinite(Number(detalle.base_calculo)) ? Number(detalle.base_calculo) : 0;
            const porcentaje = Number.isFinite(Number(detalle.porcentaje)) ? Number(detalle.porcentaje) : 0;
            const importe = Number.isFinite(Number(detalle.importe)) ? Number(detalle.importe) : 0;
            const importeOriginal = Number.isFinite(Number(detalle.importe_original)) ? Number(detalle.importe_original) : importe;
            await connection.query(
              `INSERT INTO liquidaciones_detalle
               (empresa_id, liquidacion_id, concepto_id, orden, formula_tipo_id, formula_tipo, suma_resta, codigo_concepto, nombre_concepto, cantidad, base_calculo, porcentaje, importe, tope_aplicado_id, importe_original, requiere_revision, advertencia, descripcion)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
              [
                empresaId,
                insertResult.insertId,
                detalle.concepto_id,
                detalle.orden ?? null,
                detalle.formula_tipo_id ?? null,
                detalle.formula_tipo ?? null,
                detalle.suma_resta ?? null,
                detalle.codigo_concepto,
                detalle.nombre_concepto,
                cantidad,
                baseCalculo,
                porcentaje,
                importe,
                detalle.tope_aplicado_id ?? null,
                importeOriginal,
                detalle.requiere_revision ? 1 : 0,
                detalle.advertencia ?? null,
                detalle.descripcion,
              ]
            );
          }

          createdIds.push(insertResult.insertId);
        }

        await connection.commit();
        return res.status(201).json({ message: 'Liquidaciones calculadas', insertadas: createdIds.length, ids: createdIds });
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
        const [rows] = await pool.query(
          'SELECT liquidacion_id FROM liquidaciones WHERE liquidacion_id = ? AND empresa_id = ? LIMIT 1',
          [liquidacion_id, empresaId]
        );
        if (!rows.length) return sendError(res, 404, 'Liquidacion no encontrada', null);

        const [detalleRows] = await pool.query(
          `SELECT d.*
           FROM liquidaciones_detalle d
           WHERE d.liquidacion_id = ? AND d.empresa_id = ?
           ORDER BY COALESCE(d.orden, 9999) ASC, d.liquidacion_detalle_id ASC`,
          [liquidacion_id, empresaId]
        );

        return res.json({
          liquidacion_id: Number(liquidacion_id),
          detalle: detalleRows,
        });
      } catch (error) {
        console.error('liquidacion detalle error:', error);
        return sendError(res, 500, 'Error al obtener detalle', error.message);
      }
    },

    async remove(req, res) {
      const connection = await pool.getConnection();
      try {
        const empresaId = req.user.empresa_id;
        const liquidacionId = Number(req.params.liquidacion_id);
        const razon = req.body?.razon ?? req.query?.razon ?? 'Borrado de liquidacion';

        if (!Number.isInteger(liquidacionId) || liquidacionId <= 0) {
          return sendError(res, 400, 'liquidacion_id inválido', null);
        }

        await connection.beginTransaction();

        const [liqRows] = await connection.query(
          `SELECT liquidacion_id, estado, empleado_id, periodo_id, periodo
           FROM liquidaciones
           WHERE empresa_id = ? AND liquidacion_id = ?
           LIMIT 1`,
          [empresaId, liquidacionId]
        );
        if (!liqRows.length) {
          await connection.rollback();
          return sendError(res, 404, 'Liquidacion no encontrada', null);
        }

        const estadoActualRow = await getEstadoLiquidacionById(connection, liqRows[0].estado);
        const estadoActualNombre = String(estadoActualRow?.nombre || '').toLowerCase();
        if (estadoActualNombre !== 'edicion' && estadoActualNombre !== 'edición') {
          await connection.rollback();
          return sendError(res, 409, 'Solo se puede eliminar una liquidacion en Edicion. Para cerradas use Reabrir o Anular.', null);
        }

        await connection.query('DELETE FROM liquidaciones_detalle WHERE empresa_id = ? AND liquidacion_id = ?', [empresaId, liquidacionId]);
        await connection.query('DELETE FROM liquidaciones WHERE empresa_id = ? AND liquidacion_id = ?', [empresaId, liquidacionId]);

        await connection.query(
          `INSERT INTO auditoria_global (empresa_id, usuario_id, table_name, pk_name, pk_value, action, old_values, new_values, reason)
           VALUES (?, ?, ?, ?, ?, 'delete', ?, NULL, ?)` ,
          [
            empresaId,
            req.user?.usuario_id ?? null,
            'liquidaciones',
            'liquidacion_id',
            String(liquidacionId),
            JSON.stringify({ liquidacion_id: liquidacionId, estado: liqRows[0].estado, empleado_id: liqRows[0].empleado_id, periodo_id: liqRows[0].periodo_id, periodo: liqRows[0].periodo }),
            razon,
          ]
        );

        await connection.commit();
        return res.json({ message: 'Liquidacion eliminada', liquidacion_id: liquidacionId });
      } catch (error) {
        await connection.rollback();
        console.error('liquidacion delete error:', error);
        return sendError(res, 500, 'Error al eliminar liquidacion', error.message);
      } finally {
        connection.release();
      }
    },

    async reabrir(req, res) {
      const connection = await pool.getConnection();
      try {
        const empresaId = req.user.empresa_id;
        const liquidacionId = Number(req.params.liquidacion_id);
        const razon = req.body?.razon ?? req.query?.razon ?? 'Reapertura controlada';

        if (!Number.isInteger(liquidacionId) || liquidacionId <= 0) {
          return sendError(res, 400, 'liquidacion_id inválido', null);
        }

        await connection.beginTransaction();

        const [liqRows] = await connection.query(
          `SELECT liquidacion_id, estado
           FROM liquidaciones
           WHERE empresa_id = ? AND liquidacion_id = ?
           LIMIT 1`,
          [empresaId, liquidacionId]
        );
        if (!liqRows.length) {
          await connection.rollback();
          return sendError(res, 404, 'Liquidacion no encontrada', null);
        }

        const estadoEdicionId = await getEstadoEdicionId(connection);
        if (!estadoEdicionId) {
          await connection.rollback();
          return sendError(res, 500, 'No se pudo resolver el estado Edicion', null);
        }

        const currentEstadoId = Number(liqRows[0].estado);
        if (currentEstadoId === Number(estadoEdicionId)) {
          await connection.commit();
          return res.json({ liquidacion_id: liquidacionId, estado: currentEstadoId, estado_anterior: currentEstadoId, message: 'La liquidacion ya estaba en Edicion' });
        }

        await connection.query(
          'UPDATE liquidaciones SET estado = ? WHERE empresa_id = ? AND liquidacion_id = ?',
          [estadoEdicionId, empresaId, liquidacionId]
        );

        await connection.query(
          `INSERT INTO auditoria_global (empresa_id, usuario_id, table_name, pk_name, pk_value, action, old_values, new_values, reason)
           VALUES (?, ?, ?, ?, ?, 'update', ?, ?, ?)` ,
          [
            empresaId,
            req.user?.usuario_id ?? null,
            'liquidaciones',
            'liquidacion_id',
            String(liquidacionId),
            JSON.stringify({ estado: currentEstadoId }),
            JSON.stringify({ estado: estadoEdicionId }),
            razon,
          ]
        );

        await connection.commit();
        return res.json({ liquidacion_id: liquidacionId, estado: estadoEdicionId, estado_anterior: currentEstadoId });
      } catch (error) {
        await connection.rollback();
        console.error('liquidacion reabrir error:', error);
        return sendError(res, 500, 'Error al reabrir liquidacion', error.message);
      } finally {
        connection.release();
      }
    },

    async anular(req, res) {
      const connection = await pool.getConnection();
      try {
        const empresaId = req.user.empresa_id;
        const liquidacionId = Number(req.params.liquidacion_id);
        const razon = req.body?.razon ?? req.query?.razon ?? 'Anulacion de liquidacion';

        if (!Number.isInteger(liquidacionId) || liquidacionId <= 0) {
          return sendError(res, 400, 'liquidacion_id inválido', null);
        }

        await connection.beginTransaction();

        const [liqRows] = await connection.query(
          `SELECT liquidacion_id, estado
           FROM liquidaciones
           WHERE empresa_id = ? AND liquidacion_id = ?
           LIMIT 1`,
          [empresaId, liquidacionId]
        );
        if (!liqRows.length) {
          await connection.rollback();
          return sendError(res, 404, 'Liquidacion no encontrada', null);
        }

        const estadoAnulada = await getEstadoLiquidacionByNombre(connection, 'anulada');
        if (!estadoAnulada || Number(estadoAnulada.es_activo) !== 1) {
          await connection.rollback();
          return sendError(res, 409, 'No existe un estado activo "Anulada" en estados_liquidaciones', null);
        }

        const currentEstadoId = Number(liqRows[0].estado);
        if (currentEstadoId === Number(estadoAnulada.estado_liquidacion_id)) {
          await connection.commit();
          return res.json({ liquidacion_id: liquidacionId, estado: currentEstadoId, estado_anterior: currentEstadoId, message: 'La liquidacion ya estaba anulada' });
        }

        await connection.query(
          'UPDATE liquidaciones SET estado = ? WHERE empresa_id = ? AND liquidacion_id = ?',
          [estadoAnulada.estado_liquidacion_id, empresaId, liquidacionId]
        );

        await connection.query(
          `INSERT INTO auditoria_global (empresa_id, usuario_id, table_name, pk_name, pk_value, action, old_values, new_values, reason)
           VALUES (?, ?, ?, ?, ?, 'update', ?, ?, ?)` ,
          [
            empresaId,
            req.user?.usuario_id ?? null,
            'liquidaciones',
            'liquidacion_id',
            String(liquidacionId),
            JSON.stringify({ estado: currentEstadoId }),
            JSON.stringify({ estado: estadoAnulada.estado_liquidacion_id }),
            razon,
          ]
        );

        await connection.commit();
        return res.json({ liquidacion_id: liquidacionId, estado: estadoAnulada.estado_liquidacion_id, estado_anterior: currentEstadoId, estado_objeto: estadoAnulada });
      } catch (error) {
        await connection.rollback();
        console.error('liquidacion anular error:', error);
        return sendError(res, 500, 'Error al anular liquidacion', error.message);
      } finally {
        connection.release();
      }
    },

    async cambiarEstado(req, res) {
      const connection = await pool.getConnection();
      try {
        const empresaId = req.user.empresa_id;
        const liquidacionId = Number(req.params.liquidacion_id);
        const estadoPayload = req.body?.estado_liquidacion_id ?? req.body?.estado ?? req.body?.estadoId;

        if (!Number.isInteger(liquidacionId) || liquidacionId <= 0) {
          return sendError(res, 400, 'liquidacion_id inválido', null);
        }
        if (!Number.isInteger(Number(estadoPayload))) {
          return sendError(res, 400, 'estado_liquidacion_id inválido', null);
        }

        await connection.beginTransaction();

        const [liqRows] = await connection.query(
          `SELECT liquidacion_id, estado, empleado_id, periodo_id, periodo
           FROM liquidaciones
           WHERE empresa_id = ? AND liquidacion_id = ?
           LIMIT 1`,
          [empresaId, liquidacionId]
        );
        if (!liqRows.length) {
          await connection.rollback();
          return sendError(res, 404, 'Liquidacion no encontrada', null);
        }

        const currentEstadoId = Number(liqRows[0].estado);
        const targetEstadoId = Number(estadoPayload);

        const [estadoRows] = await connection.query(
          `SELECT estado_liquidacion_id, nombre, descripcion, es_activo
           FROM estados_liquidaciones
           WHERE estado_liquidacion_id = ? LIMIT 1`,
          [targetEstadoId]
        );
        if (!estadoRows.length || Number(estadoRows[0].es_activo) !== 1) {
          await connection.rollback();
          return sendError(res, 400, 'El estado de liquidación no existe o está inactivo', null);
        }

        const estadoActualRow = await getEstadoLiquidacionById(connection, currentEstadoId);
        const estadoActualNombre = estadoActualRow?.nombre ? String(estadoActualRow.nombre).toLowerCase() : '';
        const estadoTargetNombre = String(estadoRows[0].nombre || '').toLowerCase();

        const transicionesPermitidas = new Set([
          'edicion->revision',
          'revision->edicion',
          'revision->cerrada',
          'edicion->cerrada',
        ]);

        const keyTransicion = `${estadoActualNombre}->${estadoTargetNombre}`;
        if (currentEstadoId !== targetEstadoId && !transicionesPermitidas.has(keyTransicion)) {
          await connection.rollback();
          return sendError(res, 409, `Transición no permitida de ${estadoActualRow?.nombre ?? currentEstadoId} a ${estadoRows[0].nombre}`, null);
        }

        if (currentEstadoId === targetEstadoId) {
          await connection.commit();
          return res.json({
            liquidacion_id: liquidacionId,
            estado: currentEstadoId,
            estado_anterior: currentEstadoId,
            estado_objeto: estadoRows[0],
            message: 'La liquidacion ya se encontraba en ese estado',
          });
        }

        await connection.query(
          `UPDATE liquidaciones
           SET estado = ?
           WHERE empresa_id = ? AND liquidacion_id = ?`,
          [targetEstadoId, empresaId, liquidacionId]
        );

        await connection.query(
          `INSERT INTO auditoria_global (empresa_id, usuario_id, table_name, pk_name, pk_value, action, old_values, new_values, reason)
           VALUES (?, ?, ?, ?, ?, 'update', ?, ?, ?)`,
          [
            empresaId,
            req.user?.usuario_id ?? null,
            'liquidaciones',
            'liquidacion_id',
            String(liquidacionId),
            JSON.stringify({ estado: currentEstadoId }),
            JSON.stringify({ estado: targetEstadoId }),
            req.body?.razon_override ?? `Cambio de estado a ${estadoRows[0].nombre}`,
          ]
        );

        await connection.commit();
        return res.json({
          liquidacion_id: liquidacionId,
          estado: targetEstadoId,
          estado_anterior: currentEstadoId,
          estado_objeto: estadoRows[0],
        });
      } catch (error) {
        await connection.rollback();
        console.error('liquidacion change-state error:', error);
        return sendError(res, 500, 'Error al cambiar estado de liquidacion', error.message);
      } finally {
        connection.release();
      }
    },
  };
}
