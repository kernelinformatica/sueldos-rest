import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';

function buildToken(user) {
  return jwt.sign(
    {
      usuario_id: user.usuario_id,
      empresa_id: user.empresa_id,
      rol_id: user.rol_id,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function buildUserSession(userRow, empresaRow, rolRow, permisos) {
  return {
    usuario_id: userRow.usuario_id,
    empresa: empresaRow,
    rol: rolRow,
    permisos,
    usuario: {
      usuario_id: userRow.usuario_id,
      empresa_id: userRow.empresa_id,
      rol_id: userRow.rol_id,
      username: userRow.username,
      email: userRow.email,
      nombre: userRow.nombre,
      apellido: userRow.apellido,
      ultimo_acceso: userRow.ultimo_acceso,
      ultimo_ip: userRow.ultimo_ip,
      intentos_fallidos: userRow.intentos_fallidos,
      bloqueado_hasta: userRow.bloqueado_hasta,
      password_fecha_cambio: userRow.password_fecha_cambio,
      estado_id: userRow.estado_id,
      created_at: userRow.created_at,
      updated_at: userRow.updated_at,
    },
  };
}

async function loadUserSessionById(usuarioId) {
  const [userRows] = await pool.query(
    `SELECT u.usuario_id, u.empresa_id, u.rol_id, u.username, u.email, u.password_hash, u.nombre, u.apellido,
            u.ultimo_acceso, u.ultimo_ip, u.intentos_fallidos, u.bloqueado_hasta, u.password_fecha_cambio,
            u.created_at, u.updated_at, u.estado_id,
            e.empresa_id AS empresa_empresa_id, e.codigo AS empresa_codigo, e.nombre AS empresa_nombre,
            e.nombre_fantasia, e.cuit AS empresa_cuit, e.condicion_iva_id, e.tipo_sociedad_id, e.inicio_actividades,
            e.ingresos_brutos, e.direccion AS empresa_direccion, e.localidad AS empresa_localidad,
            e.provincia_id, e.codigo_postal, e.pais_id, e.telefono AS empresa_telefono, e.celular AS empresa_celular,
            e.email AS empresa_email, e.web, e.logo, e.leyenda_recibo, e.forma_pago_id, e.estado_id AS empresa_estado_id,
            r.id AS rol_id, r.empresa_id AS rol_empresa_id, r.alias, r.nivel, r.nombre AS rol_nombre,
            r.descripcion AS rol_descripcion, r.estado_id AS rol_estado_id
     FROM usuarios u
     INNER JOIN empresas e ON e.empresa_id = u.empresa_id
     INNER JOIN rol r ON r.id = u.rol_id
     WHERE u.usuario_id = ?
     LIMIT 1`,
    [usuarioId]
  );

  if (userRows.length === 0) {
    return null;
  }

  const row = userRows[0];
  const [permRows] = await pool.query(
    `SELECT p.id, p.empresa_id, p.nombre, p.descripcion, p.alias, p.modulo, p.grupo, p.icono, p.router, p.esMenu, p.estado as permiso_estado,
            rp.orden, rp.estado as rp_estado
     FROM rolPermiso rp
     INNER JOIN permiso p ON p.id = rp.permisoId
     WHERE rp.rolId = ? AND rp.empresa_id = ?
     ORDER BY rp.orden ASC, p.grupo ASC, p.nombre ASC`,
    [row.rol_id, row.empresa_id]
  );

  // Filtrar en memoria por permisos activos y asignaciones activas (rp.estado = 1 AND p.estado = 1)
  const permisosFiltrados = permRows
    .filter((r) => Number(r.permiso_estado) === 1 && Number(r.rp_estado) === 1)
    .map((permiso) => ({
      id: permiso.id,
      empresa_id: permiso.empresa_id,
      nombre: permiso.nombre,
      descripcion: permiso.descripcion,
      alias: permiso.alias,
      modulo: permiso.modulo,
      grupo: permiso.grupo,
      icono: permiso.icono,
      router: permiso.router,
      esMenu: permiso.esMenu,
      estado: permiso.permiso_estado,
      orden: permiso.orden,
    }));

  const empresa = {
    empresa_id: row.empresa_empresa_id,
    codigo: row.empresa_codigo,
    nombre: row.empresa_nombre,
    nombre_fantasia: row.nombre_fantasia,
    cuit: row.empresa_cuit,
    condicion_iva_id: row.condicion_iva_id,
    tipo_sociedad_id: row.tipo_sociedad_id,
    inicio_actividades: row.inicio_actividades,
    ingresos_brutos: row.ingresos_brutos,
    direccion: row.empresa_direccion,
    localidad: row.empresa_localidad,
    provincia_id: row.provincia_id,
    codigo_postal: row.codigo_postal,
    pais_id: row.pais_id,
    telefono: row.empresa_telefono,
    celular: row.empresa_celular,
    email: row.empresa_email,
    web: row.web,
    logo: row.logo,
    leyenda_recibo: row.leyenda_recibo,
    forma_pago_id: row.forma_pago_id,
    estado_id: row.empresa_estado_id,
  };

  const rol = {
    id: row.rol_id,
    empresa_id: row.rol_empresa_id,
    alias: row.alias,
    nivel: row.nivel,
    nombre: row.rol_nombre,
    descripcion: row.rol_descripcion,
    estado_id: row.rol_estado_id,
  };

  return {
    row,
    session: buildUserSession(row, empresa, rol, permisosFiltrados),
  };
}

export async function register(req, res) {
  try {
    const { email, password, role = 'user', fullName = null } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'email y password son obligatorios' });
    }

    const [existing] = await pool.query('SELECT usuario_id FROM usuarios WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'El usuario ya existe' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO usuarios (empresa_id, rol_id, username, email, password_hash, nombre, apellido, estado_id) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [1, 3, email, email, passwordHash, fullName, '']
    );

    const token = buildToken({
      usuario_id: result.insertId,
      empresa_id: 1,
      rol_id: 3,
      email,
    });

    return res.status(201).json({ message: 'Usuario creado', token });
  } catch (error) {
    console.error('register error:', error);
    return res.status(500).json({ message: 'Error al registrar usuario' });
  }
}

export async function login(req, res) {
  try {
    const { email, password, codigo_cliente } = req.body;

    if (!email || !password || !codigo_cliente) {
      return res.status(400).json({ message: 'email, password y codigo_cliente son obligatorios' });
    }

    const [rows] = await pool.query(
      `SELECT u.usuario_id, u.empresa_id, u.rol_id, u.username, u.email, u.password_hash, u.nombre, u.apellido,
              u.ultimo_acceso, u.ultimo_ip, u.intentos_fallidos, u.bloqueado_hasta, u.password_fecha_cambio,
              u.created_at, u.updated_at, u.estado_id,
              e.empresa_id AS empresa_empresa_id, e.codigo AS empresa_codigo, e.nombre AS empresa_nombre,
              e.nombre_fantasia, e.cuit AS empresa_cuit, e.condicion_iva_id, e.tipo_sociedad_id, e.inicio_actividades,
              e.ingresos_brutos, e.direccion AS empresa_direccion, e.localidad AS empresa_localidad,
              e.provincia_id, e.codigo_postal, e.pais_id, e.telefono AS empresa_telefono, e.celular AS empresa_celular,
              e.email AS empresa_email, e.web, e.logo, e.leyenda_recibo, e.forma_pago_id, e.estado_id AS empresa_estado_id,
              r.id AS rol_id, r.empresa_id AS rol_empresa_id, r.alias, r.nivel, r.nombre AS rol_nombre,
              r.descripcion AS rol_descripcion, r.estado_id AS rol_estado_id
       FROM usuarios u
       INNER JOIN empresas e ON e.empresa_id = u.empresa_id
       INNER JOIN rol r ON r.id = u.rol_id
       WHERE u.email = ? AND e.cuit = ?
       LIMIT 1`,
      [email, codigo_cliente]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const userRow = rows[0];
    if (!userRow.estado_id || userRow.estado_id !== 1) {
      return res.status(403).json({ message: 'Usuario deshabilitado' });
    }

    const validPassword = await bcrypt.compare(password, userRow.password_hash);
    if (!validPassword) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const sessionData = await loadUserSessionById(userRow.usuario_id);
    if (!sessionData) {
      return res.status(401).json({ message: 'No se pudo cargar la sesión del usuario' });
    }

    const { row, session } = sessionData;

    if (row.empresa_cuit !== codigo_cliente) {
      return res.status(401).json({ message: 'La empresa no coincide con el codigo_cliente' });
    }

    const token = buildToken(row);
    return res.json({ message: 'Login correcto', token, user: session });
  } catch (error) {
    console.error('login error:', error);
    return res.status(500).json({ message: 'Error al iniciar sesión' });
  }
}

export async function me(req, res) {
  return res.json({ user: req.user });
}