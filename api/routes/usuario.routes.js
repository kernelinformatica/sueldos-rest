import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { sendError } from '../utils/response.util.js';

const router = Router();
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const [rows] = await pool.query(
      `SELECT u.usuario_id, u.empresa_id, u.rol_id, u.username, u.email, u.nombre, u.apellido, u.estado_id,
              e.nombre AS empresa_nombre, e.cuit AS empresa_cuit, r.nombre AS rol_nombre, r.alias AS rol_alias
       FROM usuarios u
       INNER JOIN empresas e ON e.empresa_id = u.empresa_id
       INNER JOIN rol r ON r.id = u.rol_id
       WHERE u.empresa_id = ?
       ORDER BY u.usuario_id DESC`,
      [empresaId]
    );
    return res.json(rows);
  } catch (error) {
    console.error('usuarios list error:', error);
    return sendError(res, 500, 'Error al listar usuarios', error.message);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const [rows] = await pool.query(
      `SELECT u.usuario_id, u.empresa_id, u.rol_id, u.username, u.email, u.nombre, u.apellido, u.estado_id,
              e.nombre AS empresa_nombre, e.cuit AS empresa_cuit, r.nombre AS rol_nombre, r.alias AS rol_alias
       FROM usuarios u
       INNER JOIN empresas e ON e.empresa_id = u.empresa_id
       INNER JOIN rol r ON r.id = u.rol_id
       WHERE u.usuario_id = ? AND u.empresa_id = ? LIMIT 1`,
      [req.params.id, empresaId]
    );
    if (!rows.length) return sendError(res, 404, 'Usuario no encontrado', null);
    return res.json(rows[0]);
  } catch (error) {
    console.error('usuarios get error:', error);
    return sendError(res, 500, 'Error al obtener usuario', error.message);
  }
});

router.post('/', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const { rol_id, username, email, password_hash, nombre, apellido, estado_id = 1 } = req.body;
    if (!rol_id || !username || !email || !password_hash || !nombre || !apellido) {
      return sendError(res, 400, 'rol_id, username, email, password_hash, nombre y apellido son obligatorios', null);
    }

    const [existsEmail] = await pool.query('SELECT 1 FROM usuarios WHERE empresa_id = ? AND email = ? LIMIT 1', [empresaId, email]);
    if (existsEmail.length) return sendError(res, 409, 'Ya existe un usuario con ese email', null);

    const [existsUsername] = await pool.query('SELECT 1 FROM usuarios WHERE empresa_id = ? AND username = ? LIMIT 1', [empresaId, username]);
    if (existsUsername.length) return sendError(res, 409, 'Ya existe un usuario con ese usuario', null);

    const [roleRows] = await pool.query('SELECT id, empresa_id FROM rol WHERE id = ? AND empresa_id = ? LIMIT 1', [rol_id, empresaId]);
    if (!roleRows.length) return sendError(res, 400, 'El rol no pertenece a la empresa', null);

    const hashed = await bcrypt.hash(password_hash, 10);
    const [result] = await pool.query(
      `INSERT INTO usuarios (empresa_id, rol_id, username, email, password_hash, nombre, apellido, estado_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, rol_id, username, email, hashed, nombre, apellido, estado_id]
    );

    const [created] = await pool.query('SELECT usuario_id, empresa_id, rol_id, username, email, nombre, apellido, estado_id FROM usuarios WHERE usuario_id = ?', [result.insertId]);
    return res.status(201).json(created[0]);
  } catch (error) {
    console.error('usuarios create error:', error);
    return sendError(res, 500, 'Error al crear usuario', error.message);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const [currentRows] = await pool.query('SELECT * FROM usuarios WHERE usuario_id = ? AND empresa_id = ? LIMIT 1', [req.params.id, empresaId]);
    if (!currentRows.length) return sendError(res, 404, 'Usuario no encontrado', null);
    const current = currentRows[0];
    const { rol_id = current.rol_id, username = current.username, email = current.email, password_hash, nombre = current.nombre, apellido = current.apellido, estado_id = current.estado_id } = req.body;

    const [roleRows] = await pool.query('SELECT id FROM rol WHERE id = ? AND empresa_id = ? LIMIT 1', [rol_id, empresaId]);
    if (!roleRows.length) return sendError(res, 400, 'El rol no pertenece a la empresa', null);

    if (email !== current.email) {
      const [existsEmail] = await pool.query('SELECT 1 FROM usuarios WHERE empresa_id = ? AND email = ? AND usuario_id <> ? LIMIT 1', [empresaId, email, req.params.id]);
      if (existsEmail.length) return sendError(res, 409, 'Ya existe un usuario con ese email', null);
    }

    if (username !== current.username) {
      const [existsUsername] = await pool.query('SELECT 1 FROM usuarios WHERE empresa_id = ? AND username = ? AND usuario_id <> ? LIMIT 1', [empresaId, username, req.params.id]);
      if (existsUsername.length) return sendError(res, 409, 'Ya existe un usuario con ese usuario', null);
    }

    const hashed = password_hash ? await bcrypt.hash(password_hash, 10) : current.password_hash;
    await pool.query(
      `UPDATE usuarios SET rol_id = ?, username = ?, email = ?, password_hash = ?, nombre = ?, apellido = ?, estado_id = ?
       WHERE usuario_id = ? AND empresa_id = ?`,
      [rol_id, username, email, hashed, nombre, apellido, estado_id, req.params.id, empresaId]
    );

    const [updated] = await pool.query('SELECT usuario_id, empresa_id, rol_id, username, email, nombre, apellido, estado_id FROM usuarios WHERE usuario_id = ?', [req.params.id]);
    return res.json(updated[0]);
  } catch (error) {
    console.error('usuarios update error:', error);
    return sendError(res, 500, 'Error al actualizar usuario', error.message);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id;
    const [result] = await pool.query('DELETE FROM usuarios WHERE usuario_id = ? AND empresa_id = ?', [req.params.id, empresaId]);
    if (!result.affectedRows) return sendError(res, 404, 'Usuario no encontrado', null);
    return res.status(204).send();
  } catch (error) {
    console.error('usuarios delete error:', error);
    return sendError(res, 500, 'Error al eliminar usuario', error.message);
  }
});

export default router;
