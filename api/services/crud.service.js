import bcrypt from 'bcryptjs';
import pool from '../db.js';

function isEmpty(value) {
  return value === undefined || value === null || value === '';
}

async function queryOne(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function queryMany(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

function buildWhere(filters, alias = '') {
  const clauses = [];
  const params = [];
  const prefix = alias ? `${alias}.` : '';

  Object.entries(filters).forEach(([field, value]) => {
    if (!isEmpty(value)) {
      clauses.push(`${prefix}${field} = ?`);
      params.push(value);
    }
  });

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function pick(obj, keys) {
  return keys.reduce((acc, key) => {
    if (obj[key] !== undefined) acc[key] = obj[key];
    return acc;
  }, {});
}

export function createCrudController(config) {
  const {
    table,
    pk,
    columns = [],
    listColumns = columns.length ? columns : ['*'],
    createColumns = columns.length ? columns.filter((column) => column !== pk) : null,
    updateColumns = columns.length ? columns.filter((column) => column !== pk) : null,
    companyScoped = false,
    companyField = 'empresa_id',
    passwordField = null,
    listJoin = '',
    getJoin = listJoin,
    listOrderBy = `${pk} DESC`,
  } = config;
  const nullableColumns = config.nullableColumns || [];

  return {
    async list(req, res) {
      try {
        const filters = {};
        if (companyScoped) filters[companyField] = req.user?.empresa_id ?? req.query[companyField];
        // ignore common control/query params that are not table columns
        const ignoredQueryParams = ['page', 'per_page', 'perPage', 'limit', 'offset', 'q', 'search', 'order', 'sort'];
        Object.entries(req.query).forEach(([key, value]) => {
          if (key === companyField) return;
          if (ignoredQueryParams.includes(key)) return;
          if (!isEmpty(value)) {
            filters[key] = value;
          }
        });
        const { whereSql, params } = buildWhere(filters);
        const rows = await queryMany(
          `SELECT ${listColumns.join(', ')} FROM ${table} ${listJoin} ${whereSql} ORDER BY ${listOrderBy}`,
          params
        );
        return res.json(rows);
      } catch (error) {
        console.error(`${table} list error:`, error);
        return res.status(500).json({ message: `Error al listar ${table}` });
      }
    },

    async getById(req, res) {
      try {
        const filters = { [pk]: req.params.id };
        if (companyScoped) filters[companyField] = req.user?.empresa_id ?? req.query[companyField];
        const { whereSql, params } = buildWhere(filters, table);
        const row = await queryOne(
          `SELECT ${listColumns.join(', ')} FROM ${table} ${getJoin} ${whereSql} LIMIT 1`,
          params
        );
        if (!row) return res.status(404).json({ message: 'Registro no encontrado' });
        return res.json(row);
      } catch (error) {
        console.error(`${table} getById error:`, error);
        return res.status(500).json({ message: `Error al obtener ${table}` });
      }
    },

    async create(req, res) {
      try {
        const payload = createColumns ? pick(req.body, createColumns) : { ...req.body };
        if (companyScoped && isEmpty(payload[companyField])) {
          payload[companyField] = req.user?.empresa_id;
        }
        if (passwordField && !isEmpty(payload[passwordField])) {
          payload[passwordField] = await bcrypt.hash(payload[passwordField], 10);
        }

        const keys = Object.keys(payload).filter((key) => {
          if (payload[key] === undefined) return false;
          if (payload[key] === null) return nullableColumns.includes(key);
          return payload[key] !== '';
        });
        if (!keys.length) {
          return res.status(400).json({ message: 'No hay datos para crear' });
        }

        const values = keys.map((key) => payload[key]);
        const placeholders = keys.map(() => '?').join(', ');
        const columnsSql = keys.join(', ');
        const [result] = await pool.query(`INSERT INTO ${table} (${columnsSql}) VALUES (${placeholders})`, values);

        const created = await queryOne(`SELECT ${listColumns.join(', ')} FROM ${table} WHERE ${pk} = ? LIMIT 1`, [result.insertId]);

        // audit log (non-blocking)
        (async () => {
          try {
            if (!String(table).toLowerCase().includes('liquidacion')) {
              const usuarioId = req.user?.usuario_id ?? null;
              const empresaId = req.user?.empresa_id ?? null;
              await pool.query(
                `INSERT INTO auditoria_global (empresa_id, usuario_id, table_name, pk_name, pk_value, action, old_values, new_values, reason) VALUES (?, ?, ?, ?, ?, 'create', NULL, ?, ?)`,
                [empresaId, usuarioId, table, pk, String(result.insertId), JSON.stringify(created), req.body?.razon_override ?? null]
              );
            }
          } catch (e) {
            console.error('audit insert error (create):', e.message || e);
          }
        })();

        return res.status(201).json(created);
      } catch (error) {
        console.error(`${table} create error:`, error);
        return res.status(500).json({ message: `Error al crear ${table}` });
      }
    },

    async update(req, res) {
      try {
        const payload = updateColumns ? pick(req.body, updateColumns) : { ...req.body };
        if (passwordField && !isEmpty(payload[passwordField])) {
          payload[passwordField] = await bcrypt.hash(payload[passwordField], 10);
        }

        const keys = Object.keys(payload).filter((key) => {
          if (payload[key] === undefined) return false;
          if (payload[key] === null) return nullableColumns.includes(key);
          return payload[key] !== '';
        });
        if (!keys.length) {
          return res.status(400).json({ message: 'No hay datos para actualizar' });
        }
        // fetch old row for audit
        let oldRow = null;
        try {
          const [oldRows] = await pool.query(`SELECT ${listColumns.join(', ')} FROM ${table} WHERE ${pk} = ? LIMIT 1`, [req.params.id]);
          oldRow = oldRows.length ? oldRows[0] : null;
        } catch (e) {
          oldRow = null;
        }

        const setSql = keys.map((key) => `${key} = ?`).join(', ');
        const values = keys.map((key) => payload[key]);
        values.push(req.params.id);
        if (companyScoped) {
          values.push(req.user?.empresa_id);
        }

        const companyWhere = companyScoped ? ` AND ${companyField} = ?` : '';
        const [result] = await pool.query(`UPDATE ${table} SET ${setSql} WHERE ${pk} = ?${companyWhere}`, values);

        if (result.affectedRows === 0) {
          return res.status(404).json({ message: 'Registro no encontrado' });
        }

        const updated = await queryOne(`SELECT ${listColumns.join(', ')} FROM ${table} WHERE ${pk} = ? LIMIT 1`, [req.params.id]);

        // audit log (non-blocking)
        (async () => {
          try {
            if (!String(table).toLowerCase().includes('liquidacion')) {
              const usuarioId = req.user?.usuario_id ?? null;
              const empresaId = companyScoped ? (req.user?.empresa_id ?? null) : null;
              await pool.query(
                `INSERT INTO auditoria_global (empresa_id, usuario_id, table_name, pk_name, pk_value, action, old_values, new_values, reason) VALUES (?, ?, ?, ?, ?, 'update', ?, ?, ?)`,
                [empresaId, usuarioId, table, pk, String(req.params.id), JSON.stringify(oldRow), JSON.stringify(updated), req.body?.razon_override ?? null]
              );
            }
          } catch (e) {
            console.error('audit insert error (update):', e.message || e);
          }
        })();

        return res.json(updated);
      } catch (error) {
        console.error(`${table} update error:`, error);
        return res.status(500).json({ message: `Error al actualizar ${table}` });
      }
    },

    async remove(req, res) {
      try {
        const params = [req.params.id];
        const companyWhere = companyScoped ? ` AND ${companyField} = ?` : '';
        if (companyScoped) params.push(req.user?.empresa_id);
        const [result] = await pool.query(`DELETE FROM ${table} WHERE ${pk} = ?${companyWhere}`, params);
        if (result.affectedRows === 0) {
          return res.status(404).json({ message: 'Registro no encontrado' });
        }
        return res.status(204).send();
      } catch (error) {
        console.error(`${table} delete error:`, error);
        // Detect foreign key constraint preventing delete
        if (error && (error.errno === 1451 || error.code === 'ER_ROW_IS_REFERENCED_2')) {
          let childTable = null;
          try {
            const m = (error.sqlMessage || '').match(/fails \(`[^`]+`\.`([^`]+)`/);
            if (m) childTable = m[1];
          } catch (e) {
            childTable = null;
          }
          const msg = childTable
            ? `No se puede eliminar: existe referencia en la tabla ${childTable}. Elimine las referencias primero.`
            : 'No se puede eliminar: el registro está referenciado en otra tabla. Elimine las referencias primero.';
          return res.status(409).json({ message: msg });
        }
        return res.status(500).json({ message: `Error al eliminar ${table}` });
      }
    },

    async exists(req, res) {
      try {
        const filters = pick(req.query, Object.keys(req.query));
        const { whereSql, params } = buildWhere(filters, table);
        const row = await queryOne(
          `SELECT 1 AS found FROM ${table} ${whereSql} LIMIT 1`,
          params
        );
        return res.json({ exists: !!row });
      } catch (error) {
        console.error(`${table} exists error:`, error);
        return res.status(500).json({ message: `Error al validar ${table}` });
      }
    },
  };
}
