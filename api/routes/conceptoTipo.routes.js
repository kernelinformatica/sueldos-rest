import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createCrudController } from '../services/crud.service.js';
import pool from '../db.js';

const controller = createCrudController({
  table: 'conceptos_tipos',
  pk: 'conceptos_tipos_id',
  companyScoped: true,
  listOrderBy: 'prioridad ASC, codigo ASC',
});

const router = Router();
router.use(authenticateToken);

// return full catalog without pagination (small table)
router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    // detect existing columns in DB and select them so real values are returned
    const [colsRows] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conceptos_tipos'`
    );
    const existingCols = colsRows.map((c) => c.COLUMN_NAME);
    const extraCols = [
      'permite_formula',
      'default_suma_resta',
      'afecta_sueldo',
      'afecta_sac',
      'default_unidades',
      'calculation_template',
      'enforce_type_rules',
    ];
    const baseCols = ['conceptos_tipos_id', 'empresa_id', 'codigo', 'nombre', 'descripcion', 'prioridad'];
    const selectCols = baseCols.concat(extraCols.filter((c) => existingCols.includes(c)));

    const sql = `SELECT ${selectCols.join(', ')} FROM conceptos_tipos WHERE empresa_id = ? ORDER BY prioridad ASC, codigo ASC`;
    const [rows] = await pool.query(sql, [empresaId]);

    const enriched = rows.map((r) => ({
      conceptos_tipos_id: r.conceptos_tipos_id,
      empresa_id: r.empresa_id,
      codigo: r.codigo,
      nombre: r.nombre,
      descripcion: r.descripcion,
      prioridad: r.prioridad,
      // `permite_importe_fijo` now lives on grupos; do not expose here by default
      permite_formula: r.permite_formula !== undefined ? r.permite_formula : 1,
      default_suma_resta: r.default_suma_resta !== undefined ? r.default_suma_resta : 'S',
      afecta_sueldo: r.afecta_sueldo !== undefined ? r.afecta_sueldo : 0,
      afecta_sac: r.afecta_sac !== undefined ? r.afecta_sac : 0,
      default_unidades: r.default_unidades !== undefined ? r.default_unidades : 1,
      calculation_template: r.calculation_template !== undefined ? r.calculation_template : null,
      enforce_type_rules: r.enforce_type_rules !== undefined ? r.enforce_type_rules : 0,
    }));

    return res.json({ data: enriched, meta: { total: enriched.length, returned: enriched.length } });
  } catch (e) {
    console.error('conceptos_tipos list error:', e);
    return res.status(500).json({ error: 'Error al listar tipos de conceptos' });
  }
});

// keep CRUD for single operations
router.get('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const id = req.params.id;
    const [colsRows] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conceptos_tipos'`
    );
    const existingCols = colsRows.map((c) => c.COLUMN_NAME);
    const extraCols = [
      'permite_formula',
      'default_suma_resta',
      'afecta_sueldo',
      'afecta_sac',
      'default_unidades',
      'calculation_template',
      'enforce_type_rules',
    ];
    const baseCols = ['conceptos_tipos_id', 'empresa_id', 'codigo', 'nombre', 'descripcion', 'prioridad'];
    const selectCols = baseCols.concat(extraCols.filter((c) => existingCols.includes(c)));
    const sql = `SELECT ${selectCols.join(', ')} FROM conceptos_tipos WHERE conceptos_tipos_id = ? AND empresa_id = ? LIMIT 1`;
    const [rows] = await pool.query(sql, [id, empresaId]);
    if (!rows.length) return res.status(404).json({ message: 'Registro no encontrado' });
    const r = rows[0];
    const out = {
      conceptos_tipos_id: r.conceptos_tipos_id,
      empresa_id: r.empresa_id,
      codigo: r.codigo,
      nombre: r.nombre,
      descripcion: r.descripcion,
      prioridad: r.prioridad,
      // `permite_importe_fijo` removed from tipos; use grupos' flag when relevant
      permite_formula: r.permite_formula !== undefined ? r.permite_formula : 1,
      default_suma_resta: r.default_suma_resta !== undefined ? r.default_suma_resta : 'S',
      afecta_sueldo: r.afecta_sueldo !== undefined ? r.afecta_sueldo : 0,
      afecta_sac: r.afecta_sac !== undefined ? r.afecta_sac : 0,
      default_unidades: r.default_unidades !== undefined ? r.default_unidades : 1,
      calculation_template: r.calculation_template !== undefined ? r.calculation_template : null,
      enforce_type_rules: r.enforce_type_rules !== undefined ? r.enforce_type_rules : 0,
    };
    return res.json(out);
  } catch (e) {
    console.error('conceptos_tipos getById error:', e);
    return res.status(500).json({ error: 'Error al obtener tipo de concepto' });
  }
});
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

export default router;
