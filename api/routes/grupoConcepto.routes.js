import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';
import pool from '../db.js';

const controller = createCrudController({
  table: 'grupos_conceptos_master',
  pk: 'grupo_id',
  companyScoped: true,
  listOrderBy: 'nombre ASC',
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

// return full catalog without pagination (requires permiso 'grupos')
router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    console.log(`GET /api/grupos_conceptos_master called by user=${req.user?.id || req.user?.usuario || 'unknown'} rol=${rolId} empresa=${empresaId}`);
    const ok = await hasPermission('grupos', rolId, empresaId);
    console.log('permiso grupos:', ok);
    if (!ok) {
      // Usuario autenticado pero sin permiso 'grupos' -> 403 Forbidden
      return res.status(403).json({ error: 'Permiso requerido: grupos' });
    }
    const [rows] = await pool.query(
      `SELECT grupo_id, empresa_id, codigo, alias, nombre, descripcion, comentario, orden, permite_importe_fijo, es_default_sistema FROM grupos_conceptos_master WHERE empresa_id = ? ORDER BY orden ASC`,
      [empresaId]
    );
    console.log('grupos_conceptos_master rows:', rows.length);

    // Adjuntar conceptos relacionados a cada grupo
    if (rows.length) {
      const grupoIds = rows.map(r => r.grupo_id);
      const placeholders = grupoIds.map(() => '?').join(',');
      const [crows] = await pool.query(
        `SELECT d.grupo_id, d.grupo_detalle_id, d.concepto_id, c.codigo, c.descripcion, c.multiplicador, c.divisor, c.detalle, c.suma_resta, c.es_sueldo_basico, c.sueldo_basico_key
         FROM grupos_conceptos_detalle d
         INNER JOIN conceptos c ON c.concepto_id = d.concepto_id
         WHERE d.grupo_id IN (${placeholders})
         ORDER BY d.grupo_id, d.grupo_detalle_id DESC`,
        grupoIds
      );
      const map = new Map();
      for (const r of crows) {
        const g = map.get(r.grupo_id) || [];
        g.push({
          grupo_detalle_id: r.grupo_detalle_id,
          concepto_id: r.concepto_id,
          codigo: r.codigo,
          descripcion: r.descripcion,
          multiplicador: r.multiplicador,
          divisor: r.divisor,
          detalle: r.detalle,
          suma_resta: r.suma_resta,
          es_sueldo_basico: r.es_sueldo_basico,
          sueldo_basico_key: r.sueldo_basico_key,
        });
        map.set(r.grupo_id, g);
      }
      for (const row of rows) {
        row.conceptos = map.get(row.grupo_id) || [];
      }
      console.log('attached conceptos to groups');
    } else {
      for (const row of rows) row.conceptos = [];
    }

    return res.json({ data: rows, meta: { total: rows.length, returned: rows.length } });
  } catch (e) {
    console.error('grupos_conceptos_master list error:', e);
    return res.status(500).json({ error: 'Error al listar grupos de conceptos' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const ok = await hasPermission('grupos', rolId, empresaId);
    if (!ok) return res.status(401).json({ error: 'No autorizado' });
    return await controller.getById(req, res);
  } catch (e) {
    console.error('grupos get error:', e);
    return res.status(500).json({ error: 'Error al obtener grupo' });
  }
});

// Crear grupo (permiso 'grupos_crear')
router.post('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const ok = await hasPermission('grupos_crear', rolId, empresaId);
    if (!ok) return res.status(403).json({ error: 'Permiso requerido: grupos_crear' });
    const payload = req.body || {};
    if (!payload.empresa_id) payload.empresa_id = empresaId;
    return await controller.create(req, res);
  } catch (e) {
    console.error('grupos create error:', e);
    return res.status(500).json({ error: 'Error al crear grupo' });
  }
});

// Custom update: prevent modifying system-default groups
router.put('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const id = req.params.id;
    // permiso para editar grupos
    const okPerm = await hasPermission('grupos_editar', rolId, empresaId);
    if (!okPerm) return res.status(403).json({ error: 'Permiso requerido: grupos_editar' });
    const [rows] = await pool.query('SELECT es_default_sistema FROM grupos_conceptos_master WHERE grupo_id = ? AND empresa_id = ? LIMIT 1', [id, empresaId]);
    if (rows.length && Number(rows[0].es_default_sistema) === 1) {
      return res.status(403).json({ error: 'Grupo del sistema: no puede ser modificado' });
    }
    return await controller.update(req, res);
  } catch (e) {
    console.error('grupo update wrapper error:', e);
    return res.status(500).json({ error: 'Error al actualizar grupo' });
  }
});

// Custom delete: prevent removing system-default groups
router.delete('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolId = req.user.rol_id;
    const id = req.params.id;
    const okPerm = await hasPermission('grupos_eliminar', rolId, empresaId);
    if (!okPerm) return res.status(403).json({ error: 'Permiso requerido: grupos_eliminar' });
    const [rows] = await pool.query('SELECT es_default_sistema FROM grupos_conceptos_master WHERE grupo_id = ? AND empresa_id = ? LIMIT 1', [id, empresaId]);
    if (rows.length && Number(rows[0].es_default_sistema) === 1) {
      return res.status(403).json({ error: 'Grupo del sistema: no puede ser eliminado' });
    }
    return await controller.remove(req, res);
  } catch (e) {
    console.error('grupo delete wrapper error:', e);
    return res.status(500).json({ error: 'Error al eliminar grupo' });
  }
});

export default router;
