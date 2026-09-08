import pool from '../../db.js';

async function fetchEmpleadoBase(empresaId, empleadoId) {
  const [rows] = await pool.query(
    `SELECT e.empleado_id, e.empresa_id, e.fecha_ingreso, e.fecha_egreso, e.convenio_categoria_id,
            e.tipo_contratacion_id, e.forma_pago_id,
            cc.sueldo_basico AS categoria_sueldo_basico, cc.valor_hora, cc.valor_dia,
            ct.modo_pago_id,
            fp.nombre AS forma_pago_nombre
     FROM empleados e
     LEFT JOIN convenios_categorias cc ON cc.categoria_id = e.convenio_categoria_id
     LEFT JOIN contrataciones_tipos ct ON ct.contrataciones_tipos_id = e.tipo_contratacion_id
     LEFT JOIN formas_pago fp ON fp.forma_pago_id = e.forma_pago_id
     WHERE e.empresa_id = ? AND e.empleado_id = ? LIMIT 1`,
    [empresaId, empleadoId]
  );
  return rows[0] ?? null;
}

async function fetchSalarioVigente(empresaId, empleadoId, fechaLiquidacion) {
  const [rows] = await pool.query(
    `SELECT monto, fecha_desde, fecha_hasta
     FROM empleados_salarios
     WHERE empresa_id = ? AND empleado_id = ?
       AND fecha_desde <= ?
       AND (fecha_hasta IS NULL OR fecha_hasta >= ?)
     ORDER BY fecha_desde DESC, salario_id DESC
     LIMIT 1`,
    [empresaId, empleadoId, fechaLiquidacion, fechaLiquidacion]
  );
  return rows[0] ?? null;
}

async function fetchAsistenciaResumen(empresaId, empleadoId, fechaDesde, fechaHasta) {
  const [rows] = await pool.query(
    `SELECT
        COALESCE(SUM(horas_extras_50), 0) AS horas_extras_50,
        COALESCE(SUM(horas_extras_100), 0) AS horas_extras_100,
        COALESCE(SUM(horas_trabajadas), 0) AS horas_trabajadas,
        COUNT(*) AS dias_registrados
     FROM empleados_asistencia
     WHERE empresa_id = ? AND empleado_id = ? AND fecha BETWEEN ? AND ?`,
    [empresaId, empleadoId, fechaDesde, fechaHasta]
  );
  return rows[0] ?? { horas_extras_50: 0, horas_extras_100: 0, horas_trabajadas: 0, dias_registrados: 0 };
}

async function fetchConceptosAsignados(empresaId, empleadoId, fechaLiquidacion) {
  const [rows] = await pool.query(
    `SELECT ec.empleado_concepto_id, ec.concepto_id, ec.unidades, ec.importe, ec.fecha_asignacion,
            c.codigo, c.descripcion, c.grupo_id, c.tipo_concepto_id, c.formula_tipo_id,
            c.importe_fijo, c.multiplicador, c.divisor, c.suma_resta, c.es_sueldo_basico,
            ft.codigo AS formula_tipo_codigo,
            ft.orden AS formula_tipo_orden
     FROM empleados_conceptos ec
     INNER JOIN conceptos c ON c.concepto_id = ec.concepto_id
     LEFT JOIN formula_tipos ft ON ft.formula_tipo_id = c.formula_tipo_id
     WHERE ec.empresa_id = ? AND ec.empleado_id = ? AND ec.fecha_asignacion <= ?
     ORDER BY COALESCE(ft.orden, 9999) ASC, c.codigo ASC, ec.fecha_asignacion ASC, ec.empleado_concepto_id ASC`,
    [empresaId, empleadoId, fechaLiquidacion]
  );
  return rows.map((row) => ({
    ...row,
    formula_tipo_orden: row.formula_tipo_orden !== null && row.formula_tipo_orden !== undefined
      ? Number(row.formula_tipo_orden)
      : null,
  }));
}

async function fetchGruposConceptosDetalle(empresaId) {
  const [rows] = await pool.query(
    `SELECT d.grupo_id, d.concepto_id
     FROM grupos_conceptos_detalle d
     INNER JOIN grupos_conceptos_master g ON g.grupo_id = d.grupo_id
     WHERE g.empresa_id = ?`,
    [empresaId]
  );

  return rows.reduce((acc, row) => {
    const grupoId = Number(row.grupo_id);
    const conceptoId = Number(row.concepto_id);
    if (!acc[grupoId]) acc[grupoId] = new Set();
    if (Number.isInteger(conceptoId) && conceptoId > 0) acc[grupoId].add(conceptoId);
    return acc;
  }, {});
}

export async function fetchEmpleadosActivosPorIds(empresaId, empleadoIds) {
  if (!Array.isArray(empleadoIds) || !empleadoIds.length) return [];

  const placeholders = empleadoIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT e.empleado_id, e.empresa_id, e.fecha_ingreso, e.fecha_egreso, e.convenio_categoria_id,
            e.tipo_contratacion_id, e.forma_pago_id,
            cc.sueldo_basico AS categoria_sueldo_basico, cc.valor_hora, cc.valor_dia,
            ct.modo_pago_id,
            fp.nombre AS forma_pago_nombre
     FROM empleados e
     LEFT JOIN convenios_categorias cc ON cc.categoria_id = e.convenio_categoria_id
     LEFT JOIN contrataciones_tipos ct ON ct.contrataciones_tipos_id = e.tipo_contratacion_id
     LEFT JOIN formas_pago fp ON fp.forma_pago_id = e.forma_pago_id
     WHERE e.empresa_id = ? AND e.estado = 1 AND e.empleado_id IN (${placeholders})`,
    [empresaId, ...empleadoIds]
  );

  return rows;
}

export async function buildLiquidacionContext(empresaId, empleadoId, fechaDesde, fechaHasta, fechaLiquidacion) {
  const empleado = await fetchEmpleadoBase(empresaId, empleadoId);
  if (!empleado) return null;

  const salario = await fetchSalarioVigente(empresaId, empleadoId, fechaLiquidacion);
  const asistencia = await fetchAsistenciaResumen(empresaId, empleadoId, fechaDesde, fechaHasta);
  const conceptos = await fetchConceptosAsignados(empresaId, empleadoId, fechaLiquidacion);
  const gruposConceptos = await fetchGruposConceptosDetalle(empresaId);

  return {
    empresaId,
    empleado,
    salario,
    asistencia,
    conceptos,
    gruposConceptos,
    fechaDesde,
    fechaHasta,
    fechaLiquidacion,
    basalario: salario ? Number(salario.monto) : 0,
    categoriaBasico: empleado.categoria_sueldo_basico ? Number(empleado.categoria_sueldo_basico) : 0,
    valorHora: empleado.valor_hora ? Number(empleado.valor_hora) : 0,
    valorDia: empleado.valor_dia ? Number(empleado.valor_dia) : 0,
    horasExtra50: asistencia ? Number(asistencia.horas_extras_50 || 0) : 0,
    horasExtra100: asistencia ? Number(asistencia.horas_extras_100 || 0) : 0,
    diasTrabajados: asistencia ? Number(asistencia.dias_registrados || 0) : 0,
    baseRemunerativa: 0,
    baseSac: 0,
    antiguedadAnios: empleado.fecha_ingreso ? calcularAntiguedadAnios(empleado.fecha_ingreso, fechaLiquidacion) : 0,
  };
}

function calcularAntiguedadAnios(fechaIngreso, fechaLiquidacion) {
  const ingreso = new Date(fechaIngreso);
  const liquidacion = new Date(fechaLiquidacion);
  let anios = liquidacion.getFullYear() - ingreso.getFullYear();
  const mesDiff = liquidacion.getMonth() - ingreso.getMonth();
  if (mesDiff < 0 || (mesDiff === 0 && liquidacion.getDate() < ingreso.getDate())) {
    anios -= 1;
  }
  return Math.max(anios, 0);
}

export async function fetchConceptosDeEmpresa(empresaId, empleadoId, fechaLiquidacion) {
  return fetchConceptosAsignados(empresaId, empleadoId, fechaLiquidacion);
}
