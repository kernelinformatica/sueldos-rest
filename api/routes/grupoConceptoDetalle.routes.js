import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import pool from '../db.js';

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

async function getRolAlias(rolId, empresaId) {
  const [rows] = await pool.query('SELECT alias FROM rol WHERE id = ? AND empresa_id = ? LIMIT 1', [rolId, empresaId]);
  return rows[0]?.alias ?? null;
}

function isSuperAdminAlias(alias) {
  const normalizedAlias = String(alias ?? '').trim().toLowerCase();
  return normalizedAlias === 'super_admin' || normalizedAlias === 'super_administrador' || normalizedAlias === 'super-administrador';
}

// Listar conceptos dentro de un grupo
router.get('/grupo/:grupo_id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const ok = await hasPermission('grupos', rolId, empresaId);
    if (!ok) return res.status(401).json({ error: 'No autorizado' });

    const grupoId = Number(req.params.grupo_id);
    if (!Number.isInteger(grupoId) || grupoId <= 0) return res.status(400).json({ error: 'grupo_id inválido' });

    // verificar que el grupo pertenece a la empresa
    const [gRows] = await pool.query('SELECT grupo_id FROM grupos_conceptos_master WHERE grupo_id = ? AND empresa_id = ? LIMIT 1', [grupoId, empresaId]);
    if (!gRows.length) return res.status(404).json({ error: 'Grupo no encontrado' });

    const [rows] = await pool.query(
      `SELECT d.grupo_detalle_id, d.grupo_id, d.concepto_id, c.codigo, c.descripcion
       FROM grupos_conceptos_detalle d
       INNER JOIN conceptos c ON c.concepto_id = d.concepto_id
       WHERE d.grupo_id = ?
       ORDER BY d.grupo_detalle_id DESC`,
      [grupoId]
    );
    return res.json({ data: rows, meta: { total: rows.length, returned: rows.length } });
  } catch (e) {
    console.error('grupos detalle list error:', e);
    return res.status(500).json({ error: 'Error al listar conceptos del grupo' });
  }
});

// Agregar concepto a grupo (permite editar grupo)
router.post('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const rolAlias = await getRolAlias(rolId, empresaId);
    const ok = await hasPermission('grupos_editar', rolId, empresaId);
    if (!ok) return res.status(403).json({ error: 'Permiso requerido: grupos_editar' });

    const payload = req.body || {};
    const grupoId = Number(payload.grupo_id);
    const conceptoId = Number(payload.concepto_id);
    if (!Number.isInteger(grupoId) || grupoId <= 0) return res.status(400).json({ error: 'grupo_id inválido' });
    if (!Number.isInteger(conceptoId) || conceptoId <= 0) return res.status(400).json({ error: 'concepto_id inválido' });

    // validar grupo/empresa
    const [gRows] = await pool.query('SELECT grupo_id, es_default_sistema FROM grupos_conceptos_master WHERE grupo_id = ? AND empresa_id = ? LIMIT 1', [grupoId, empresaId]);
    if (!gRows.length) return res.status(404).json({ error: 'Grupo no encontrado' });
    if (Number(gRows[0].es_default_sistema) === 1 && !isSuperAdminAlias(rolAlias)) {
      return res.status(403).json({ error: 'Grupo del sistema: solo super_admin puede modificar sus conceptos' });
    }

    // validar concepto existe y pertenece a la empresa
    const [cRows] = await pool.query('SELECT concepto_id FROM conceptos WHERE concepto_id = ? AND empresa_id = ? LIMIT 1', [conceptoId, empresaId]);
    if (!cRows.length) return res.status(404).json({ error: 'Concepto no encontrado' });

    // evitar duplicados
    const [dup] = await pool.query('SELECT grupo_detalle_id FROM grupos_conceptos_detalle WHERE grupo_id = ? AND concepto_id = ? LIMIT 1', [grupoId, conceptoId]);
    if (dup.length) return res.status(409).json({ error: 'Concepto ya asignado al grupo' });

    const [ins] = await pool.query('INSERT INTO grupos_conceptos_detalle (grupo_id, concepto_id) VALUES (?, ?)', [grupoId, conceptoId]);
    return res.status(201).json({ grupo_detalle_id: ins.insertId, grupo_id: grupoId, concepto_id: conceptoId });
  } catch (e) {
    console.error('grupos detalle create error:', e);
    return res.status(500).json({ error: 'Error al agregar concepto al grupo' });
  }
});

// Eliminar asignación por id (permite editar grupo)
router.delete('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const rolAlias = await getRolAlias(rolId, empresaId);
    const ok = await hasPermission('grupos_editar', rolId, empresaId);
    if (!ok) return res.status(403).json({ error: 'Permiso requerido: grupos_editar' });

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'grupo_detalle_id inválido' });

    // verificar que la relación existe y pertenece a un grupo de la empresa
    const [rows] = await pool.query(
      `SELECT d.grupo_detalle_id, g.es_default_sistema FROM grupos_conceptos_detalle d
       INNER JOIN grupos_conceptos_master g ON g.grupo_id = d.grupo_id
       WHERE d.grupo_detalle_id = ? AND g.empresa_id = ? LIMIT 1`,
      [id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Asignación no encontrada' });
    if (Number(rows[0].es_default_sistema) === 1 && !isSuperAdminAlias(rolAlias)) {
      return res.status(403).json({ error: 'Grupo del sistema: solo super_admin puede modificar sus conceptos' });
    }

    await pool.query('DELETE FROM grupos_conceptos_detalle WHERE grupo_detalle_id = ?', [id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error('grupos detalle delete error:', e);
    return res.status(500).json({ error: 'Error al eliminar asignación' });
  }
});

export default router;
