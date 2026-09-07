export function isNumeric(value) {
  return value !== null && value !== undefined && value !== '' && !Number.isNaN(Number(value));
}

export function toNumber(value, fallback = 0) {
  if (!isNumeric(value)) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function calcularFormulaManual(concepto, contexto) {
  const unidades = toNumber(contexto.unidades ?? concepto.unidades, 1);
  const importeBase = toNumber(concepto.importe_fijo, 0);
  return Number((importeBase * unidades).toFixed(2));
}

export function calcularFormulaBasico(concepto, contexto) {
  return Number(toNumber(contexto.basalario, 0).toFixed(2));
}

export function calcularFormulaFijo(concepto, contexto) {
  const unidades = toNumber(contexto.unidades ?? concepto.unidades, 1);
  const importeBase = toNumber(concepto.importe_fijo, 0);
  const override = contexto.overrideImporte !== undefined && contexto.overrideImporte !== null
    ? toNumber(contexto.overrideImporte, importeBase)
    : importeBase;
  return Number((override * unidades).toFixed(2));
}

export function calcularFormulaPresentismo(concepto, contexto) {
  const tieneGrupo = concepto.grupo_id !== null && concepto.grupo_id !== undefined && concepto.grupo_id !== '';
  const baseGrupo = toNumber(contexto.sumaGrupo, 0);
  const baseGeneral = toNumber(contexto.baseRemunerativa ?? contexto.basalario, 0);
  const base = tieneGrupo && baseGrupo > 0
    ? baseGrupo
    : baseGeneral;
  return Number((base * 0.01).toFixed(2));
}

export function calcularFormulaAntiguedad(concepto, contexto) {
  const anios = toNumber(contexto.antiguedadAnios, 0);
  if (anios <= 0) return 0;

  const baseGrupo = toNumber(contexto.sumaGrupo, 0);
  const baseFallback = toNumber(contexto.basalario ?? contexto.baseRemunerativa, 0);
  const base = baseGrupo > 0 ? baseGrupo : baseFallback;
  if (base <= 0) return 0;

  const multiplicador = toNumber(concepto.multiplicador, 1);
  const divisor = toNumber(concepto.divisor, 100) || 100;
  return Number(((anios * base * multiplicador) / divisor).toFixed(2));
}

export function calcularFormulaPorcentajeCategoria(concepto, contexto) {
  const base = toNumber(contexto.categoriaBasico, 0);
  const multiplicador = toNumber(concepto.multiplicador, 0);
  const divisor = toNumber(concepto.divisor, 100) || 100;
  return Number(((base * multiplicador) / divisor).toFixed(2));
}

export function calcularFormulaPorcentajeRemunerativo(concepto, contexto) {
  const base = toNumber(contexto.sumaGrupo ?? contexto.baseRemunerativa, 0);
  const multiplicador = toNumber(concepto.multiplicador, 0);
  const divisor = toNumber(concepto.divisor, 100) || 100;
  return Number(((base * multiplicador) / divisor).toFixed(2));
}

export function calcularFormulaPorcentajeGrupo(concepto, contexto) {
  const base = toNumber(contexto.sumaGrupo, 0);
  const multiplicador = toNumber(concepto.multiplicador, 0);
  const divisor = toNumber(concepto.divisor, 100) || 100;
  return Number(((base * multiplicador) / divisor).toFixed(2));
}

export function calcularFormulaSumaGrupo(concepto, contexto) {
  const unidades = toNumber(contexto.unidades ?? concepto.unidades, 1);
  const sumaGrupo = toNumber(contexto.sumaGrupo, 0);
  const multiplicador = toNumber(concepto.multiplicador, 1);
  const divisor = toNumber(concepto.divisor, 1) || 1;
  return Number(((sumaGrupo * multiplicador) / divisor * unidades).toFixed(2));
}

export function calcularFormulaHorasExtra50(concepto, contexto) {
  const horas = toNumber(contexto.horasExtra50, 0);
  const valorHora = toNumber(contexto.valorHora, 0);
  const multiplicador = toNumber(concepto.multiplicador, 150);
  const divisor = toNumber(concepto.divisor, 100) || 100;
  return Number(((horas * valorHora * multiplicador) / divisor).toFixed(2));
}

export function calcularFormulaHorasExtra100(concepto, contexto) {
  const horas = toNumber(contexto.horasExtra100, 0);
  const valorHora = toNumber(contexto.valorHora, 0);
  const multiplicador = toNumber(concepto.multiplicador, 200);
  const divisor = toNumber(concepto.divisor, 100) || 100;
  return Number(((horas * valorHora * multiplicador) / divisor).toFixed(2));
}

export function calcularFormulaSac(concepto, contexto) {
  const baseSac = toNumber(contexto.baseSac, 0);
  return Number((baseSac / 2).toFixed(2));
}

export const formulaResolvers = {
  MANUAL: calcularFormulaManual,
  BASICO: calcularFormulaBasico,
  FIJO: calcularFormulaFijo,
  PRESENTISMO: calcularFormulaPresentismo,
  ANTIGUEDAD: calcularFormulaAntiguedad,
  PORCENTAJE_CATEGORIA: calcularFormulaPorcentajeCategoria,
  PORCENTAJE_REMUNERATIVO: calcularFormulaPorcentajeRemunerativo,
  PORCENTAJE_GRUPO: calcularFormulaPorcentajeGrupo,
  SUMA_GRUPO: calcularFormulaSumaGrupo,
  HORAS_EXTRA_50: calcularFormulaHorasExtra50,
  HORAS_EXTRA_100: calcularFormulaHorasExtra100,
  SAC: calcularFormulaSac,
};