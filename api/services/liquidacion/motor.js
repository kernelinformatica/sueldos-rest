import { formulaResolvers } from './formulas.js';

function resolveFormulaKey(concepto) {
  const codigo = String(concepto.codigo ?? '').trim();
  const descripcion = String(concepto.descripcion ?? '').trim().toLowerCase();
  const tieneGrupo = concepto.grupo_id !== null && concepto.grupo_id !== undefined && concepto.grupo_id !== '';

  if (concepto.formula_tipo_codigo || concepto.formula_tipo) {
    return concepto.formula_tipo_codigo || concepto.formula_tipo;
  }
  if (codigo === '14' || descripcion === 'antiguedad') {
    return 'ANTIGUEDAD';
  }
  if (codigo === '19' || descripcion === 'presentismo') {
    return 'PRESENTISMO';
  }
  if (descripcion === 'sac') {
    return 'SAC';
  }
  if (tieneGrupo) {
    return 'SUMA_GRUPO';
  }
  return 'MANUAL';
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function esFormulaDependiente(formulaKey) {
  return formulaKey === 'PRESENTISMO'
    || formulaKey === 'ANTIGUEDAD'
    || formulaKey === 'PORCENTAJE_REMUNERATIVO'
    || formulaKey === 'PORCENTAJE_GRUPO'
    || formulaKey === 'SUMA_GRUPO';
}

function getFormulaOrden(concepto) {
  const orden = Number(concepto.formula_tipo_orden);
  return Number.isFinite(orden) ? orden : 9999;
}

function getConceptoCodigoOrden(concepto) {
  const codigo = String(concepto.codigo ?? '').trim();
  const numeric = Number(codigo);
  if (codigo !== '' && Number.isFinite(numeric)) {
    return { tipo: 0, valor: numeric };
  }

  return { tipo: 1, valor: codigo.toUpperCase() };
}

async function calcularYRegistrarConcepto(concepto, contexto, resueltos, aplicarTopeFn, resultados) {
  const formulaKey = resolveFormulaKey(concepto);
  const resolver = formulaResolvers[formulaKey] ?? formulaResolvers.MANUAL;
  const sumaGrupo = calcularSumaGrupo(contexto, concepto, resueltos);
  const contextoConcepto = {
    ...contexto,
    concepto,
    unidades: concepto.unidades,
    overrideImporte: concepto.importe,
    sumaGrupo,
    baseRemunerativa: contexto.baseRemunerativa,
    baseSac: contexto.baseSac,
  };

  const importeOriginal = toNumber(resolver(concepto, contextoConcepto), 0);
  const topeResult = aplicarTopeFn ? await aplicarTopeFn(concepto, importeOriginal, contextoConcepto) : { importe: importeOriginal };
  const importeFinal = toNumber(topeResult?.importe ?? importeOriginal, 0);

  const registro = {
    concepto_id: concepto.concepto_id,
    codigo_concepto: concepto.codigo,
    nombre_concepto: concepto.descripcion,
    formula_tipo_id: concepto.formula_tipo_id ?? null,
    formula_tipo: formulaKey,
    suma_resta: concepto.suma_resta ?? null,
    cantidad: formulaKey === 'ANTIGUEDAD'
      ? toNumber(contexto.antiguedadAnios, 0)
      : toNumber(concepto.unidades ?? concepto.cantidad, 1),
    base_calculo: contextoConcepto.sumaGrupo || null,
    porcentaje: null,
    importe_original: importeOriginal,
    importe: importeFinal,
    orden: resultados.length + 1,
    tope_aplicado_id: topeResult?.tope_aplicado_id ?? null,
    requiere_revision: Boolean(topeResult?.requiere_revision),
    advertencia: topeResult?.advertencia ?? null,
    descripcion: concepto.descripcion,
    concepto,
  };

  resultados.push(registro);
  resueltos.set(concepto.concepto_id, registro);

  if (concepto.suma_resta === 'S' || Number(concepto.es_sueldo_basico) === 1) {
    contexto.baseRemunerativa += importeFinal;
  }
  if (formulaKey === 'BASICO') {
    contexto.basalario = importeFinal;
  }
  if (formulaKey === 'SAC') {
    contexto.baseSac = importeFinal;
  }

  return registro;
}

export async function ejecutarMotorLiquidacion(contexto, aplicarTopeFn) {
  const resultados = [];
  const resueltos = new Map();
  const pendientes = [...(contexto.conceptos || [])];
  const maxIterations = Math.max(pendientes.length * 3, 1);
  let iteration = 0;

  contexto.baseRemunerativa = 0;
  contexto.baseSac = 0;
  while (pendientes.length && iteration < maxIterations) {
    iteration += 1;
    let progressed = false;

    const conceptosOrdenados = pendientes
      .map((concepto, index) => ({ concepto, index }))
      .sort((a, b) => {
        const prioridadTipoA = Number(a.concepto.tipo_concepto_prioridad ?? a.concepto.tipo_prioridad ?? a.concepto.tipo_concepto?.prioridad ?? 0);
        const prioridadTipoB = Number(b.concepto.tipo_concepto_prioridad ?? b.concepto.tipo_prioridad ?? b.concepto.tipo_concepto?.prioridad ?? 0);
        if (prioridadTipoA !== prioridadTipoB) return prioridadTipoA - prioridadTipoB;

        const esContribucionA = Number(a.concepto.tipo_concepto_id) === 5 || String(a.concepto.formula_tipo ?? '').toUpperCase() === 'SAC';
        const esContribucionB = Number(b.concepto.tipo_concepto_id) === 5 || String(b.concepto.formula_tipo ?? '').toUpperCase() === 'SAC';
        if (esContribucionA !== esContribucionB) return esContribucionA ? 1 : -1;

        const sumaA = a.concepto.suma_resta === 'S' ? 0 : 1;
        const sumaB = b.concepto.suma_resta === 'S' ? 0 : 1;
        if (sumaA !== sumaB) return sumaA - sumaB;

        const diffOrden = getFormulaOrden(a.concepto) - getFormulaOrden(b.concepto);
        if (diffOrden !== 0) return diffOrden;
        const codigoA = getConceptoCodigoOrden(a.concepto);
        const codigoB = getConceptoCodigoOrden(b.concepto);
        if (codigoA.tipo !== codigoB.tipo) return codigoA.tipo - codigoB.tipo;
        if (codigoA.valor < codigoB.valor) return -1;
        if (codigoA.valor > codigoB.valor) return 1;
        return a.index - b.index;
      });

    for (const { concepto, index } of conceptosOrdenados) {
      const formulaKey = resolveFormulaKey(concepto);
      const sumaGrupo = calcularSumaGrupo(contexto, concepto, resueltos);

      const dependenciasCumplidas = (() => {
        if (formulaKey === 'PRESENTISMO') {
          return Boolean(contexto.basalario || contexto.baseRemunerativa);
        }
        if (formulaKey === 'ANTIGUEDAD') {
          return Boolean(contexto.antiguedadAnios);
        }
        if (formulaKey === 'PORCENTAJE_GRUPO') {
          return Boolean(sumaGrupo);
        }
        if (formulaKey === 'SUMA_GRUPO') {
          return Boolean(sumaGrupo || concepto.grupo_id);
        }
        if (formulaKey === 'PORCENTAJE_REMUNERATIVO') {
          return Boolean(contexto.baseRemunerativa || contexto.basalario);
        }
        return true;
      })();

      if (!dependenciasCumplidas && esFormulaDependiente(formulaKey)) {
        continue;
      }

      const registro = await calcularYRegistrarConcepto(concepto, contexto, resueltos, aplicarTopeFn, resultados);
      const pendienteIndex = pendientes.findIndex((item) => item.concepto_id === concepto.concepto_id && item.empleado_concepto_id === concepto.empleado_concepto_id);
      if (pendienteIndex !== -1) {
        pendientes.splice(pendienteIndex, 1);
      }
      progressed = true;
    }

    if (!progressed) {
      break;
    }
  }

  if (pendientes.length) {
    for (const concepto of pendientes) {
      const formulaKey = resolveFormulaKey(concepto);
      await calcularYRegistrarConcepto(concepto, contexto, resueltos, aplicarTopeFn, resultados);
    }
  }

  const totales = resultados.reduce((acc, item) => {
    if (item.suma_resta === 'R') {
      acc.total_descuentos += toNumber(item.importe, 0);
    } else if (String(item.formula_tipo) === 'SAC' || item.concepto?.tipo_concepto_id === 5) {
      acc.total_contribuciones += toNumber(item.importe, 0);
      acc.total_costo_empresa += toNumber(item.importe, 0);
    } else {
      acc.total_haberes += toNumber(item.importe, 0);
      acc.total_costo_empresa += toNumber(item.importe, 0);
    }
    return acc;
  }, { total_haberes: 0, total_descuentos: 0, total_contribuciones: 0, total_costo_empresa: 0 });

  totales.total_neto = Number((totales.total_haberes - totales.total_descuentos).toFixed(2));

  return { resultados, totales };
}

function calcularSumaGrupo(contexto, concepto, resueltos) {
  const grupoId = concepto.grupo_id;
  if (!grupoId) return 0;
  const miembrosGrupo = contexto.gruposConceptos?.[Number(grupoId)];
  const conceptosDelGrupo = Array.isArray(miembrosGrupo)
    ? miembrosGrupo
    : miembrosGrupo instanceof Set
      ? Array.from(miembrosGrupo)
      : (contexto.conceptos || [])
        .filter((item) => Number(item.grupo_id) === Number(grupoId))
        .map((item) => item.concepto_id);

  return conceptosDelGrupo.reduce((acc, conceptoId) => acc + Number(resueltos.get(Number(conceptoId))?.importe || 0), 0);
}
