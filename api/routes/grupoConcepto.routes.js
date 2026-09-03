import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';
import pool from '../db.js';

function buildGrupoAlias(nombre) {
  return String(nombre ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const controller = createCrudController({
  table: 'grupos_conceptos_master',
  pk: 'grupo_id',
  companyScoped: true,
  listOrderBy: 'nombre ASC',
});

async function getRolAlias(rolId, empresaId) {
  const [rows] = await pool.query('SELECT alias FROM rol WHERE id = ? AND empresa_id = ? LIMIT 1', [rolId, empresaId]);
  return rows[0]?.alias ?? null;
}

function isSuperAdminAlias(alias) {
  const normalizedAlias = String(alias ?? '').trim().toLowerCase();
  return normalizedAlias === 'super_admin' || normalizedAlias === 'super_administrador' || normalizedAlias === 'super-administrador';
}

const router = Router();
router.use(authenticateToken);

// return full catalog without pagination
router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const [rows] = await pool.query(
      `SELECT g.grupo_id,
              g.empresa_id,
              g.codigo,
              g.nombre,
              LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(g.nombre), ' ', '_'), '.', '_'), ',', '_'), '/', '_'), '-', '_')) AS alias,
              g.descripcion,
              g.comentario,
              g.orden,
              g.permite_importe_fijo,
              g.es_default_sistema,
              d.grupo_detalle_id,
              d.concepto_id,
              c.codigo AS concepto_codigo,
              c.descripcion AS concepto_descripcion
       FROM grupos_conceptos_master g
       LEFT JOIN grupos_conceptos_detalle d ON d.grupo_id = g.grupo_id
       LEFT JOIN conceptos c ON c.concepto_id = d.concepto_id
       WHERE g.empresa_id = ?
       ORDER BY g.orden ASC, d.grupo_detalle_id DESC`,
      [empresaId]
    );

    const grouped = rows.reduce((accumulator, row) => {
      if (!accumulator[row.grupo_id]) {
        accumulator[row.grupo_id] = {
          grupo_id: row.grupo_id,
          empresa_id: row.empresa_id,
          codigo: row.codigo,
          nombre: row.nombre,
          alias: row.alias || buildGrupoAlias(row.nombre),
          descripcion: row.descripcion,
          comentario: row.comentario,
          orden: row.orden,
          permite_importe_fijo: row.permite_importe_fijo,
          es_default_sistema: row.es_default_sistema,
          conceptos: [],
        };
      }

      if (row.grupo_detalle_id && row.concepto_id) {
        accumulator[row.grupo_id].conceptos.push({
          grupo_detalle_id: row.grupo_detalle_id,
          grupo_id: row.grupo_id,
          concepto_id: row.concepto_id,
          codigo: row.concepto_codigo,
          descripcion: row.concepto_descripcion,
        });
      }

      return accumulator;
    }, {});

    const data = Object.values(grouped);
    return res.json({ data, meta: { total: data.length, returned: data.length } });
  } catch (e) {
    console.error('grupos_conceptos_master list error:', e);
    return res.status(500).json({ error: 'Error al listar grupos de conceptos' });
  }
});

router.get('/:id', controller.getById);
router.post('/', controller.create);

// Custom update: prevent modifying system-default groups
router.put('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const rolAlias = await getRolAlias(req.user.rol_id, empresaId);
    const id = req.params.id;
    const [rows] = await pool.query('SELECT es_default_sistema FROM grupos_conceptos_master WHERE grupo_id = ? AND empresa_id = ? LIMIT 1', [id, empresaId]);
    if (rows.length && Number(rows[0].es_default_sistema) === 1 && !isSuperAdminAlias(rolAlias)) {
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
    const id = req.params.id;
    const rolAlias = await getRolAlias(req.user.rol_id, empresaId);
    const [rows] = await pool.query('SELECT es_default_sistema FROM grupos_conceptos_master WHERE grupo_id = ? AND empresa_id = ? LIMIT 1', [id, empresaId]);
    if (rows.length && Number(rows[0].es_default_sistema) === 1 && !isSuperAdminAlias(rolAlias)) {
      return res.status(403).json({ error: 'Grupo del sistema: no puede ser eliminado' });
    }
    return await controller.remove(req, res);
  } catch (e) {
    console.error('grupo delete wrapper error:', e);
    return res.status(500).json({ error: 'Error al eliminar grupo' });
  }
});

export default router;
