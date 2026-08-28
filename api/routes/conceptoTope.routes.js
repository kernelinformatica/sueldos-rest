import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';
import pool from '../db.js';

const controller = createCrudController({
  table: 'conceptos_topes',
  pk: 'tope_id',
  companyScoped: true,
  listOrderBy: 'tope_id DESC',
  nullableColumns: ['fecha_desde', 'fecha_hasta', 'descripcion', 'valor']
});

const router = Router();
router.use(authenticateToken);

async function hasPermission(alias, rolId, empresaId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) as cnt
     FROM rolPermiso rp
     INNER JOIN permiso p ON p.id = rp.permisoId
     WHERE p.alias = ? AND rp.rolId = ? AND rp.empresa_id = ? AND rp.estado = 1 AND p.estado = 1`,
    [alias, rolId, empresaId]
  );
  return rows[0].cnt > 0;
}

// Listar topes (requiere permiso 'topes')
router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const ok = await hasPermission('topes', rolId, empresaId);
    if (!ok) return res.status(401).json({ error: 'No autorizado' });

    const sql = `SELECT t.* FROM conceptos_topes t WHERE t.empresa_id = ? ORDER BY t.tope_id DESC`;
    const [rows] = await pool.query(sql, [empresaId]);
    const out = rows.map((t) => {
      t.accion_label = t.accion === 'reject' ? 'Rechazar' : t.accion === 'clamp' ? 'Ajustar' : t.accion === 'warn' ? 'Advertir' : t.accion;
      t.tipo_label = t.tipo === 'max' ? 'Máximo' : t.tipo === 'min' ? 'Mínimo' : t.tipo;
      return t;
    });
    return res.json({ data: out });
  } catch (e) {
    console.error('topes list error:', e);
    return res.status(500).json({ error: 'Error al listar topes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const ok = await hasPermission('topes', rolId, empresaId);
    if (!ok) return res.status(401).json({ error: 'No autorizado' });

    const topeId = Number(req.params.id);
    if (!Number.isInteger(topeId) || topeId <= 0) return res.status(400).json({ error: 'tope_id inválido' });
    const [rows] = await pool.query('SELECT * FROM conceptos_topes WHERE tope_id = ? AND empresa_id = ? LIMIT 1', [topeId, empresaId]);
    if (!rows.length) return res.status(404).json({ error: 'Tope no encontrado' });
    const t = rows[0];
    t.accion_label = t.accion === 'reject' ? 'Rechazar' : t.accion === 'clamp' ? 'Ajustar' : t.accion === 'warn' ? 'Advertir' : t.accion;
    t.tipo_label = t.tipo === 'max' ? 'Máximo' : t.tipo === 'min' ? 'Mínimo' : t.tipo;
    return res.json(t);
  } catch (e) {
    console.error('topes get error:', e);
    return res.status(500).json({ error: 'Error al obtener tope' });
  }
});

// Crear tope (requiere permiso 'topes_agregar')
router.post('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const ok = await hasPermission('topes_agregar', rolId, empresaId);
    if (!ok) return res.status(403).json({ error: 'Permiso requerido: topes_agregar' });
    const payload = req.body || {};
    if (!payload.empresa_id) payload.empresa_id = empresaId;
    // accept objeto en concepto/grupo
    if (payload.concepto_id && typeof payload.concepto_id === 'object') payload.concepto_id = payload.concepto_id.concepto_id ?? payload.concepto_id.id ?? payload.concepto_id;
    if (payload.grupo_id && typeof payload.grupo_id === 'object') payload.grupo_id = payload.grupo_id.grupo_id ?? payload.grupo_id.id ?? payload.grupo_id;
    // si recibimos concepto_id: validar existencia en `conceptos` y pertenencia a la empresa
    // la FK de la tabla `conceptos_topes` referencia ahora a `conceptos.concepto_id`.
    if (payload.concepto_id) {
      const cId = Number(payload.concepto_id);
      if (!Number.isInteger(cId) || cId <= 0) return res.status(400).json({ error: 'concepto_id inválido' });
      const [cRows] = await pool.query('SELECT concepto_id, grupo_id, empresa_id FROM conceptos WHERE concepto_id = ? LIMIT 1', [cId]);
      if (!cRows.length) return res.status(400).json({ error: 'Concepto referenciado no existe' });
      const conceptoRow = cRows[0];
      if (Number(conceptoRow.empresa_id) !== Number(empresaId)) return res.status(400).json({ error: 'El concepto no pertenece a la empresa' });
      if (!payload.grupo_id && conceptoRow.grupo_id) payload.grupo_id = conceptoRow.grupo_id;
      // dejamos payload.concepto_id tal cual (es PK de conceptos y coincide con la FK ahora)
    }
    req.body = payload;
    return await controller.create(req, res);
  } catch (e) {
    console.error('topes create error:', e);
    return res.status(500).json({ error: 'Error al crear tope' });
  }
});

// Actualizar tope (requiere permiso 'topes_editar')
router.put('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const ok = await hasPermission('topes_editar', rolId, empresaId);
    if (!ok) return res.status(403).json({ error: 'Permiso requerido: topes_editar' });
    const payload = req.body || {};
    if (payload.concepto_id && typeof payload.concepto_id === 'object') payload.concepto_id = payload.concepto_id.concepto_id ?? payload.concepto_id.id ?? payload.concepto_id;
    if (payload.grupo_id && typeof payload.grupo_id === 'object') payload.grupo_id = payload.grupo_id.grupo_id ?? payload.grupo_id.id ?? payload.grupo_id;
    // validar concepto_id como PK de `conceptos` y completar grupo_id si falta
    if (payload.concepto_id) {
      const cId = Number(payload.concepto_id);
      if (!Number.isInteger(cId) || cId <= 0) return res.status(400).json({ error: 'concepto_id inválido' });
      const [cRows] = await pool.query('SELECT concepto_id, grupo_id, empresa_id FROM conceptos WHERE concepto_id = ? LIMIT 1', [cId]);
      if (!cRows.length) return res.status(400).json({ error: 'Concepto referenciado no existe' });
      const conceptoRow = cRows[0];
      if (Number(conceptoRow.empresa_id) !== Number(empresaId)) return res.status(400).json({ error: 'El concepto no pertenece a la empresa' });
      if (!payload.grupo_id && conceptoRow.grupo_id) payload.grupo_id = conceptoRow.grupo_id;
    }
    req.body = payload;
    return await controller.update(req, res);
  } catch (e) {
    console.error('topes update error:', e);
    return res.status(500).json({ error: 'Error al actualizar tope' });
  }
});

// Eliminar tope (requiere permiso 'topes_eliminar')
router.delete('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const ok = await hasPermission('topes_eliminar', rolId, empresaId);
    if (!ok) return res.status(403).json({ error: 'Permiso requerido: topes_eliminar' });
    return await controller.remove(req, res);
  } catch (e) {
    console.error('topes delete error:', e);
    return res.status(500).json({ error: 'Error al eliminar tope' });
  }
});

export default router;
