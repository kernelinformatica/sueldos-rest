import pool from '../db.js';

const accionLabels = { reject: 'Rechazar', clamp: 'Ajustar', warn: 'Advertir' };
const tipoLabels = { max: 'Máximo', min: 'Mínimo' };

export async function findTopApplicable(empresaId, conceptoId, grupoId, fecha = null) {
  const query = `
    SELECT * FROM conceptos_topes t
    WHERE t.empresa_id = ?
      AND (t.concepto_id = ? OR (t.concepto_id IS NULL AND t.grupo_id = ?) OR (t.concepto_id IS NULL AND t.grupo_id IS NULL))
      AND t.activo = 1
      AND (t.fecha_desde IS NULL OR t.fecha_desde <= COALESCE(?, CURDATE()))
      AND (t.fecha_hasta IS NULL OR t.fecha_hasta >= COALESCE(?, CURDATE()))
    ORDER BY
      CASE WHEN t.concepto_id IS NOT NULL THEN 1 WHEN t.grupo_id IS NOT NULL THEN 2 ELSE 3 END ASC,
      t.tope_id DESC
    LIMIT 1`;

  const dateParam = fecha ?? null;
  const [rows] = await pool.query(query, [empresaId, conceptoId, grupoId, dateParam, dateParam]);
  if (!rows.length) return null;

  const top = rows[0];
  top.accion_label = accionLabels[top.accion] ?? top.accion;
  top.tipo_label = tipoLabels[top.tipo] ?? top.tipo;
  return top;
}

export function computeTopValue(tope, baseValue = null) {
  if (!tope) return null;
  if (String(tope.unidad) === 'porcentaje') {
    const base = baseValue ?? 0;
    return Number(((base * Number(tope.valor)) / 100).toFixed(2));
  }
  return Number(tope.valor);
}
