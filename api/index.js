



import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import bodyParser from 'body-parser';
import authRouter from './routes/auth.routes.js';
import { authenticateToken } from './middlewares/auth.middleware.js';
import pool from './db.js';
import { sendError } from './utils/response.util.js';
import empresaRouter from './routes/empresa.routes.js';
import usuarioRouter from './routes/usuario.routes.js';
import rolRouter from './routes/rol.routes.js';
import permisoRouter from './routes/permiso.routes.js';
import sucursalRouter from './routes/sucursal.routes.js';
import cargoRouter from './routes/cargo.routes.js';
import seccionRouter from './routes/seccion.routes.js';
import provinciaRouter from './routes/provincia.routes.js';
import bancoRouter from './routes/banco.routes.js';
import obraSocialRouter from './routes/obraSocial.routes.js';
import empleadoRouter from './routes/empleado.routes.js';
import convenioRouter from './routes/convenio.routes.js';
import convenioCategoriaRouter from './routes/convenioCategoria.routes.js';
import contratacionTipoRouter from './routes/contratacionTipo.routes.js';
import formaPagoRouter from './routes/formaPago.routes.js';
import localidadRouter from './routes/localidad.routes.js';
import estadoRouter from './routes/estado.routes.js';
import estadoEmpleadoRouter from './routes/estadoEmpleado.routes.js';
import estadoLiquidacionRouter from './routes/estadoLiquidacion.routes.js';
import conceptoRouter from './routes/concepto.routes.js';
import conceptoTipoRouter from './routes/conceptoTipo.routes.js';
import formulaTipoRouter from './routes/formulaTipo.routes.js';
import grupoConceptoRouter from './routes/grupoConcepto.routes.js';
import grupoConceptoDetalleRouter from './routes/grupoConceptoDetalle.routes.js';
import periodoLiquidacionRouter from './routes/periodoLiquidacion.routes.js';
import liquidacionRouter from './routes/liquidacion.routes.js';
import novedadRouter from './routes/novedad.routes.js';
import empleadoCuentaBancariaRouter from './routes/empleadoCuentaBancaria.routes.js';
import empleadoAsistenciaRouter from './routes/empleadoAsistencia.routes.js';
import conceptoTopeRouter from './routes/conceptoTope.routes.js';
import dashboardRouter from './routes/dashboard.routes.js';
import liquidacionTipoRouter from './routes/liquidacionTipo.routes.js';
import { createEmployeeService } from './services/employee.service.js';






const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3500;
const DOMAIN = process.env.HOST ;
console.log(`Host configurado : ${DOMAIN}:${PORT}`);
// CORS seguro solo para el frontend
const FRONTEND_ORIGIN = process.env.CORS_ORIGIN;
app.use(cors({
  origin: FRONTEND_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(bodyParser.json({ limit: '50mb' }));

app.get('/media/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const publicPath = `/media/${filename}`;

    const [rows] = await pool.query(
      `SELECT ruta_archivo
       FROM empleados_archivos
       WHERE url_publica = ?
       ORDER BY created_at DESC, archivo_id DESC
       LIMIT 1`,
      [publicPath]
    );

    if (!rows.length || !rows[0].ruta_archivo) {
      return sendError(res, 404, 'Archivo no encontrado', null);
    }

    // Resolver ruta relativa al directorio de uploads si es necesario
    const uploadRoot = path.join(__dirname, 'upload');
    let archivoRuta = rows[0].ruta_archivo;
    try {
      if (!path.isAbsolute(archivoRuta)) {
        archivoRuta = path.join(uploadRoot, archivoRuta);
      }
    } catch (e) {
      archivoRuta = path.join(uploadRoot, path.basename(rows[0].ruta_archivo));
    }

    if (!fs.existsSync(archivoRuta)) {
      return sendError(res, 404, 'Archivo no encontrado', null);
    }

    return res.sendFile(path.resolve(archivoRuta));
  } catch (error) {
    console.error('media file error:', error);
    return sendError(res, 500, 'Error al obtener archivo', error.message);
  }
});

app.use('/api/auth', authRouter);
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', message: 'API Sueldos funcionando' });
});

app.use(authenticateToken);

app.use('/api/empresas', empresaRouter);
app.use('/api/usuarios', usuarioRouter);
app.use('/api/roles', rolRouter);
app.use('/api/permisos', permisoRouter);
app.use('/api/sucursales', sucursalRouter);
app.use('/api/cargos', cargoRouter);
app.use('/api/secciones', seccionRouter);
app.use('/api/provincias', provinciaRouter);
app.use('/api/bancos', bancoRouter);
app.use('/api/obras-sociales', obraSocialRouter);
app.use('/api/empleados', empleadoRouter);
app.use('/api/convenios', convenioRouter);
app.use('/api/convenios-categorias', convenioCategoriaRouter);
app.use('/api/contrataciones-tipos', contratacionTipoRouter);
app.use('/api/formas-pago', formaPagoRouter);
app.use('/api/localidades', localidadRouter);
app.use('/api/estados', estadoRouter);
app.use('/api/estados-empleados', estadoEmpleadoRouter);
app.use('/api/estados-liquidaciones', estadoLiquidacionRouter);
app.use('/api/conceptos', conceptoRouter);
app.use('/api/conceptos_tipos', conceptoTipoRouter);
app.use('/api/formula-tipos', formulaTipoRouter);
app.use('/api/grupos_conceptos_master', grupoConceptoRouter);
app.use('/api/grupos_conceptos_detalle', grupoConceptoDetalleRouter);
app.use('/api/periodos-liquidacion', periodoLiquidacionRouter);
app.use('/api/liquidaciones', liquidacionRouter);
app.use('/api/novedades', novedadRouter);
app.use('/api/empleados-cuentas-bancarias', empleadoCuentaBancariaRouter);
app.use('/api/empleados-asistencia', empleadoAsistenciaRouter);
app.use('/api/topes', conceptoTopeRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/liquidacion-tipos', liquidacionTipoRouter);

const employeeService = createEmployeeService();
app.get('/api/empleados-basico', authenticateToken, employeeService.list);
app.post('/api/empleados-basico', authenticateToken, employeeService.create);
app.put('/api/empleados-basico/:id', authenticateToken, employeeService.update);
app.delete('/api/empleados-basico/:id', authenticateToken, employeeService.remove);

app.get('/api/me', authenticateToken, (req, res) => {
  res.json({ status: 'ok', user: req.user });
});



app.listen(PORT, DOMAIN, () => {
  console.log(`API Sueldos corriendo en -> ${DOMAIN}:${PORT}`);
});
