import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { createEmployeeService } from '../services/employee.service.js';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { sendError } from '../utils/response.util.js';
import { randomUUID } from 'crypto';

// Resolve permite_importe_fijo: read from grupo only (tipo column removed), default 0
async function resolvePermiteImporte(empresaId, grupoId /* tipoId deprecated */) {
	try {
		if (grupoId) {
			const [gRows] = await pool.query('SELECT permite_importe_fijo FROM grupos_conceptos_master WHERE grupo_id = ? AND empresa_id = ? LIMIT 1', [grupoId, empresaId]);
			if (gRows.length && gRows[0].permite_importe_fijo !== undefined && gRows[0].permite_importe_fijo !== null) return Number(gRows[0].permite_importe_fijo);
		}
	} catch (e) {
		console.error('resolvePermiteImporte error:', e.message || e);
	}
	return 0;
}

const controller = createEmployeeService();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadRoot = path.join(__dirname, '..', 'upload');
const mediaPublicBase = '/media';

// Use async directory creation to avoid blocking the event loop on large uploads
function ensureDirectoryAsync(targetPath, cb) {
	fs.mkdir(targetPath, { recursive: true }, cb);
}

function buildFileAlias(originalName) {
	const baseName = path.parse(originalName).name;
	return baseName
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ\s.-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function buildPublicAlias(fileName) {
	const parsedFile = path.parse(fileName);
	const extension = parsedFile.ext.toLowerCase();
	const uniquePart = parsedFile.name.split('_').slice(0, 2).join('_');
	return `${uniquePart}${extension}`;
}

const storage = multer.diskStorage({
	destination(req, file, cb) {
		const now = new Date();
		const year = String(now.getFullYear());
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		const targetDirectory = path.join(uploadRoot, year, month, day);
		const startDir = Date.now();
		ensureDirectoryAsync(targetDirectory, (err) => {
			if (err) {
				console.error('[upload][destination] mkdir error', err);
				return cb(err);
			}
			console.log(`[upload][destination] dir ready ${targetDirectory} (${Date.now() - startDir}ms)`);
			cb(null, targetDirectory);
		});
	},
	filename(req, file, cb) {
		const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_');
		const uniquePrefix = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
		cb(null, `${uniquePrefix}_${safeName}`);
	},
});

const upload = multer({ storage });

const router = Router();
router.use(authenticateToken);
router.get('/search', async (req, res) => {
	try {
		const empresaId = Number(req.user?.empresa_id);
		if (!Number.isInteger(empresaId) || empresaId <= 0) {
			return sendError(res, 401, 'empresa_id inválido en token', null);
		}

		const term = String(req.query.q ?? req.query.query ?? req.query.search ?? '').trim();
		if (!term) {
			return sendError(res, 400, 'q es obligatorio', null);
		}

		const like = `%${term}%`;
		const params = [empresaId, like, like];
		const [rows] = await pool.query(
			`SELECT empleado_id, legajo, nombre, apellido, estado, foto
			 FROM empleados
			 WHERE empresa_id = ?
			   AND (CAST(legajo AS CHAR) LIKE ? OR CONCAT(nombre, ' ', apellido) LIKE ?)
			 ORDER BY apellido ASC, nombre ASC, legajo ASC
			 LIMIT 50`,
			params
		);

		return res.json({
			data: rows.map((row) => ({
				empleado_id: row.empleado_id,
				legajo: row.legajo,
				nombre: row.nombre,
				apellido: row.apellido,
				estado: row.estado,
				foto: row.foto ?? null,
				texto: `${row.apellido ?? ''}, ${row.nombre ?? ''}`.trim(),
			})),
			meta: { total: rows.length, query: term },
		});
	} catch (error) {
		console.error('employee search error:', error);
		return sendError(res, 500, 'Error al buscar empleados', error.message);
	}
});
router.get('/', controller.list);
router.get('/:id', controller.getById);

router.get('/:id/archivos', async (req, res) => {
	try {
		const empresaId = req.user.empresa_id;
		const { id } = req.params;

		const [employeeRows] = await pool.query(
			'SELECT empleado_id FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1',
			[id, empresaId]
		);

		if (!employeeRows.length) {
			return sendError(res, 404, 'Empleado no encontrado', null);
		}

		const [rows] = await pool.query(
			`SELECT archivo_id, empleado_id, tipo, alias, nombre_archivo, ruta_archivo, ruta_publica,
							url_publica, mime_type, extension, tamano_bytes, es_principal, descripcion,
							created_at, updated_at
			 FROM empleados_archivos
			 WHERE empleado_id = ?
			 ORDER BY es_principal DESC, created_at DESC, archivo_id DESC`,
			[id]
		);

		return res.json(rows);
	} catch (error) {
		console.error('employee archivos list error:', error);
		return sendError(res, 500, 'Error al listar archivos del empleado', error.message);
	}
});

router.post('/:id/archivos', upload.single('archivo'), async (req, res) => {
	try {
		const handlerStart = Date.now();
		const empresaId = req.user.empresa_id;
		const { id } = req.params;
		const { tipo, descripcion, es_principal } = req.body;

		console.log(`[upload][handler] start empleado=${id} originalname=${req.file?.originalname} size=${req.file?.size}`);

		if (!req.file) {
			return sendError(res, 400, 'archivo es obligatorio', null);
		}

		const [employeeRows] = await pool.query(
			'SELECT empleado_id FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1',
			[id, empresaId]
		);

		if (!employeeRows.length) {
			return sendError(res, 404, 'Empleado no encontrado', null);
		}

				const alias = req.body.alias ? String(req.body.alias) : buildFileAlias(req.file.originalname);
				const publicAlias = buildPublicAlias(path.basename(req.file.path));
				const urlPublica = `${mediaPublicBase}/${publicAlias}`;

				// Guardar la ruta relativa al `uploadRoot` para evitar paths absolutos dependientes
				// y poder resolver correctamente en distintos entornos.
				let rutaArchivoRelativa = req.file.path;
				try {
					rutaArchivoRelativa = path.relative(uploadRoot, req.file.path);
				} catch (e) {
					rutaArchivoRelativa = path.basename(req.file.path);
				}

				if (String(es_principal) === '1') {
			await pool.query(
				"UPDATE empleados_archivos SET es_principal = 0 WHERE empleado_id = ? AND empresa_id = ? AND tipo = 'foto'",
				[id, empresaId]
			);
		}

		console.log('[upload][handler] inserting metadata to DB');
		const dbInsertStart = Date.now();
		const [result] = await pool.query(
			`INSERT INTO empleados_archivos
			 (empresa_id, empleado_id, tipo, alias, nombre_archivo, ruta_archivo, ruta_publica, url_publica, mime_type, extension, tamano_bytes, es_principal, descripcion)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
			[
				empresaId,
				id,
				tipo ?? 'archivo',
				alias,
				req.file.originalname,
				rutaArchivoRelativa,
				publicAlias,
				urlPublica,
				req.file.mimetype,
				path.extname(req.file.originalname).replace('.', '').toLowerCase() || null,
				req.file.size,
				String(es_principal) === '1' ? 1 : 0,
				descripcion ?? null,
			]
		);

		console.log(`[upload][handler] DB insert took ${Date.now() - dbInsertStart}ms`);

		if (tipo === 'foto' && String(es_principal) === '1') {
			await pool.query('UPDATE empleados SET foto = ? WHERE empleado_id = ? AND empresa_id = ?', [urlPublica, id, empresaId]);
		}

		const [rows] = await pool.query(
			`SELECT archivo_id, empresa_id, empleado_id, tipo, alias, nombre_archivo, ruta_archivo, ruta_publica,
					url_publica, mime_type, extension, tamano_bytes, es_principal, descripcion,
					created_at, updated_at
			 FROM empleados_archivos
			 WHERE archivo_id = ?
			 LIMIT 1`,
			[result.insertId]
		);

		console.log(`[upload][handler] total handler time ${Date.now() - handlerStart}ms`);
		return res.status(201).json(rows[0]);
	} catch (error) {
		console.error('employee archivos upload error:', error);
		return sendError(res, 500, 'Error al subir archivo', error.message);
	}
});

router.delete('/:id/archivos/:archivoId', async (req, res) => {
	try {
		const empresaId = req.user.empresa_id;
		const { id, archivoId } = req.params;

		const [rows] = await pool.query(
			'SELECT archivo_id, ruta_archivo, tipo, es_principal FROM empleados_archivos WHERE archivo_id = ? AND empleado_id = ? AND empresa_id = ? LIMIT 1',
			[archivoId, id, empresaId]
		);

		if (!rows.length) {
			return sendError(res, 404, 'Archivo no encontrado', null);
		}

		const fileRecord = rows[0];
		if (fileRecord.ruta_archivo) {
			// Resolver ruta absoluta o relativa al `uploadRoot`.
			let absolutePath = fileRecord.ruta_archivo;
			try {
				if (!path.isAbsolute(absolutePath)) {
					absolutePath = path.join(uploadRoot, absolutePath);
				}
			} catch (e) {
				absolutePath = path.join(uploadRoot, path.basename(fileRecord.ruta_archivo));
			}

			if (fs.existsSync(absolutePath)) {
				fs.unlinkSync(absolutePath);
			}
		}

		await pool.query('DELETE FROM empleados_archivos WHERE archivo_id = ? AND empresa_id = ?', [archivoId, empresaId]);

		if (fileRecord.tipo === 'foto' && Number(fileRecord.es_principal) === 1) {
			const [principalRows] = await pool.query(
				`SELECT url_publica
				 FROM empleados_archivos
				 WHERE empleado_id = ? AND empresa_id = ? AND tipo = 'foto'
				 ORDER BY es_principal DESC, created_at DESC, archivo_id DESC
				 LIMIT 1`,
				[id, empresaId]
			);
			await pool.query('UPDATE empleados SET foto = ? WHERE empleado_id = ? AND empresa_id = ?', [principalRows[0]?.url_publica ?? null, id, empresaId]);
		}

		return res.status(204).send();
	} catch (error) {
		console.error('employee archivos delete error:', error);
		return sendError(res, 500, 'Error al eliminar archivo', error.message);
	}
});

router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

// --- Conceptos asignados a empleado
router.get('/:id/conceptos', async (req, res) => {
	try {
		const empresaId = req.user.empresa_id;
		const usuarioId = req.user.usuario_id;
		const { id } = req.params;

		const empleadoId = parseInt(id, 10);
		if (!Number.isInteger(empleadoId) || empleadoId <= 0) return res.status(400).json({ error: 'empleado_id inválido' });

		// verificar empleado existe
		const [empRows] = await pool.query('SELECT empleado_id FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1', [empleadoId, empresaId]);
		if (!empRows.length) return res.status(404).json({ data: [], meta: { total: 0 } });

		const [rows] = await pool.query(
					`SELECT ec.empleado_concepto_id,
					c.concepto_id AS c_concepto_id,
					c.descripcion AS c_descripcion,
					c.codigo AS c_codigo,
					c.detalle AS c_detalle,
					c.suma_resta AS c_suma_resta,
					    ec.unidades AS unidades,
					    ec.importe AS importe,
					c.tipo_concepto_id,
						ct.conceptos_tipos_id AS ct_conceptos_tipos_id,
						ct.descripcion AS tipo_descripcion,
						ct.codigo AS tipo_codigo,
						ct.prioridad AS ct_tipo_prioridad,
							ec.fecha_asignacion
				 FROM empleados_conceptos ec
			 INNER JOIN conceptos c ON c.concepto_id = ec.concepto_id
			 LEFT JOIN conceptos_tipos ct ON ct.conceptos_tipos_id = c.tipo_concepto_id
			 LEFT JOIN grupos_conceptos_master g ON g.grupo_id = c.grupo_id
				 WHERE ec.empleado_id = ? AND c.empresa_id = ?
				 ORDER BY COALESCE(ct.prioridad, 0) ASC, (CASE WHEN c.suma_resta = 'S' THEN 0 ELSE 1 END) ASC, c.codigo ASC, ec.fecha_asignacion DESC`,
			[empleadoId, empresaId]
		);

		const data = rows.map((r) => ({
			empleado_concepto_id: r.empleado_concepto_id,
			fecha_asignacion: r.fecha_asignacion,
			unidades: r.unidades !== null && r.unidades !== undefined ? Number(r.unidades) : null,
			importe: r.importe !== null && r.importe !== undefined ? Number(r.importe) : null,
				concepto: {
				concepto_id: r.c_concepto_id,
				descripcion: r.c_descripcion,
				codigo: r.c_codigo,
				detalle: r.c_detalle ?? null,
				suma_resta: r.c_suma_resta ?? null,
				tipo_concepto: r.tipo_concepto_id
					? { tipo_concepto_id: r.ct_conceptos_tipos_id ?? r.tipo_concepto_id, descripcion: r.tipo_descripcion ?? null, codigo: r.tipo_codigo ?? null, prioridad: r.ct_tipo_prioridad ?? 0 }
					: null,
				grupo: r.grupo_id
					? { grupo_id: r.grupo_id, nombre: r.nombre ?? null, descripcion: r.descripcion ?? null }
					: null,
			},
		}));

		return res.json({ data, meta: { total: data.length } });
	} catch (error) {
		console.error('empleado conceptos list error:', error);
		return res.status(500).json({ error: 'Error al listar conceptos asignados' });
	}
});

router.post('/:id/conceptos', async (req, res) => {
	const conn = await pool.getConnection();
	try {
		const empresaId = req.user.empresa_id;
		const usuarioId = req.user.usuario_id;
		const { id } = req.params;
		const { concepto_ids, usuario_origen, importes, razon_override } = req.body;
		const importesMap = importes || {};

		const empleadoId = parseInt(id, 10);
		if (!Number.isInteger(empleadoId) || empleadoId <= 0) return res.status(400).json({ error: 'empleado_id inválido' });
		if (!Array.isArray(concepto_ids) || concepto_ids.length === 0) return res.status(400).json({ error: 'concepto_ids obligatorio' });

		// validar conceptos: que existan y estén activos
		const ids = concepto_ids.map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v) && v > 0);
		if (ids.length !== concepto_ids.length) return res.status(400).json({ error: 'concepto_ids inválidos', invalid_ids: concepto_ids.filter((v) => !Number.isInteger(parseInt(v, 10)) || parseInt(v, 10) <= 0) });

		await conn.beginTransaction();

		const [empRows] = await conn.query('SELECT empleado_id FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1', [empleadoId, empresaId]);
		if (!empRows.length) {
			await conn.rollback();
			return res.status(404).json({ error: 'Empleado no encontrado' });
		}

		// validar que los conceptos existan y pertenezcan a la misma empresa
		const placeholders = ids.map(() => '?').join(',');
		const [validRows] = await conn.query(
			`SELECT concepto_id FROM conceptos WHERE concepto_id IN (${placeholders}) AND empresa_id = ?`,
			[...ids, empresaId]
		);
		const validIds = validRows.map((r) => r.concepto_id);
		const invalid = ids.filter((v) => !validIds.includes(v));
		if (invalid.length) {
			await conn.rollback();
			return res.status(400).json({ error: 'concepto_id inválido', invalid_ids: invalid });
		}

		const created = [];
		const skipped = [];

		for (const conceptoId of validIds) {
			// upsert-like behavior: insertar solo si no existe (filtrar por empresa)
			const [existRows] = await conn.query('SELECT empleado_concepto_id FROM empleados_conceptos WHERE empleado_id = ? AND concepto_id = ? AND empresa_id = ? LIMIT 1', [empleadoId, conceptoId, empresaId]);
			if (existRows.length) {
				skipped.push(conceptoId);
				continue;
			}


			// calcular importe a insertar en empleados_conceptos si es sueldo básico
			let importeAInsertar = null;
			let overrideUsed = false;
			try {
				const [conceptRows] = await conn.query('SELECT es_sueldo_basico, grupo_id, tipo_concepto_id, importe_fijo FROM conceptos WHERE concepto_id = ? AND empresa_id = ? LIMIT 1', [conceptoId, empresaId]);
				if (conceptRows.length && Number(conceptRows[0].es_sueldo_basico) === 1) {
					// note: grupo_id/tipo_concepto_id may be used to validate importe_fijo/overrides
					const conceptoMeta = conceptRows[0];
					const [empRows] = await conn.query('SELECT convenio_categoria_id FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1', [empleadoId, empresaId]);
					const empleadoCategoriaId = empRows.length ? empRows[0].convenio_categoria_id : null;
					if (empleadoCategoriaId) {
						const [ccRows] = await conn.query('SELECT sueldo_basico FROM convenios_categorias WHERE categoria_id = ? LIMIT 1', [empleadoCategoriaId]);
						if (ccRows.length && Number(ccRows[0].sueldo_basico) > 0) {
							importeAInsertar = Number(ccRows[0].sueldo_basico);
						}
					}
					// si no vino por la categoria, intentar usar sueldo_actual del empleado
					if (importeAInsertar === null) {
						try {
							const [empSalRows] = await conn.query('SELECT sueldo_actual FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1', [empleadoId, empresaId]);
							if (empSalRows.length && Number(empSalRows[0].sueldo_actual) > 0) {
								importeAInsertar = Number(empSalRows[0].sueldo_actual);
							}
						} catch (e) {
							console.error('error reading empleados.sueldo_actual fallback:', e);
						}
					}

					// siguiente fallback: tomar último monto en empleados_salarios
					if (importeAInsertar === null) {
						try {
							const [lastSalRows] = await conn.query('SELECT monto FROM empleados_salarios WHERE empleado_id = ? AND empresa_id = ? ORDER BY fecha_desde DESC LIMIT 1', [empleadoId, empresaId]);
							if (lastSalRows.length && Number(lastSalRows[0].monto) > 0) {
								importeAInsertar = Number(lastSalRows[0].monto);
							}
						} catch (e) {
							console.error('error reading empleados_salarios fallback:', e);
						}
					}

										// fallback final: si no hay valor calculado, usar importe provisto en el body (override)
										if (importeAInsertar === null && importesMap && importesMap[conceptoId] !== undefined) {
						const parsed = Number(importesMap[conceptoId]);
						if (!Number.isNaN(parsed) && parsed > 0) {
							importeAInsertar = parsed;
							overrideUsed = true;
						}
					}
								// validate permiso: if overrideUsed or importe comes from concepto.importe_fijo, ensure group permits importe fijo
								try {
									const permite = await resolvePermiteImporte(empresaId, conceptoMeta.grupo_id, conceptoMeta.tipo_concepto_id);
									if (overrideUsed && permite === 0) {
										await conn.rollback();
										return res.status(400).json({ error: `El grupo del concepto ${conceptoId} no permite importe fijo. Remueva el override.` });
									}
									// if importe comes from concepto.importe_fijo but group disallows, drop the importe
									if (!overrideUsed && importeAInsertar !== null && conceptoMeta && conceptoMeta.importe_fijo && Number(conceptoMeta.importe_fijo) > 0 && permite === 0) {
										importeAInsertar = null;
									}
								} catch (e) {
									console.error('permite_importe check before insert error:', e.message || e);
								}
				}
			} catch (e) {
				console.error('error fetching concepto/es_sueldo_basico before insert:', e);
			}

			const importeParam = (importeAInsertar === null || Number(importeAInsertar) === 0) ? null : importeAInsertar;
			const [insResult] = await conn.query(
				`INSERT INTO empleados_conceptos (empresa_id, empleado_id, concepto_id, fecha_asignacion, operador_codigo, nro_liquidacion, importe)
				 VALUES (?, ?, ?, NOW(), ?, ?, ?)`,
				[empresaId, empleadoId, conceptoId, usuarioId, null, importeParam]
			);
			created.push({ concepto_id: conceptoId, empleado_concepto_id: insResult.insertId });

			// Si el concepto es el sueldo básico, también sincronizar salario en empleados_salarios y sueldo_actual
			try {
				if (importeParam !== null) {
					const razonToUse = overrideUsed ? (razon_override ? `Manual override: ${String(razon_override).slice(0,200)}` : 'Manual override') : 'Asignado por concepto sueldo básico';
					if (overrideUsed && !razon_override) {
						// require reason for manual override
						await conn.rollback();
						return res.status(400).json({ error: 'razon_override es obligatoria cuando se provee un importe manual' });
					}
					await conn.query('INSERT INTO empleados_salarios (empresa_id, empleado_id, monto, fecha_desde, razon, creado_por) VALUES (?, ?, ?, CURDATE(), ?, ?)', [empresaId, empleadoId, importeAInsertar, razonToUse, usuarioId]);
					await conn.query('UPDATE empleados SET sueldo_actual = ? WHERE empleado_id = ?', [importeAInsertar, empleadoId]);
				}
			} catch (e) {
				console.error('error syncing sueldo_basico on concepto assign:', e);
			}
		}

		await conn.commit();

		console.info('asignar conceptos', { usuario: usuarioId, empleadoId, created, skipped, usuario_origen });

		return res.status(201).json({ success: true, created, skipped_already_assigned: skipped, meta: { empleado_id: empleadoId, count_created: created.length } });
	} catch (error) {
		await conn.rollback();
		console.error('empleado conceptos assign error:', error);
		return res.status(500).json({ error: 'Error al asignar conceptos' });
	} finally {
		conn.release();
	}
});

router.delete('/:id/conceptos/:conceptoId', async (req, res) => {
	const conn = await pool.getConnection();
	try {
		const empresaId = req.user.empresa_id;
		const usuarioId = req.user.usuario_id;
		const empleadoId = parseInt(req.params.id, 10);
		const conceptoParam = req.params.conceptoId;
		if (!Number.isInteger(empleadoId) || empleadoId <= 0) return res.status(400).json({ error: 'empleado_id inválido' });

		// allow deleting by empleado_concepto_id (preferred) or by concepto_id
		const maybeEmpleadoConceptoId = parseInt(conceptoParam, 10);
		if (!Number.isInteger(maybeEmpleadoConceptoId) || maybeEmpleadoConceptoId <= 0) return res.status(400).json({ error: 'concepto_id inválido' });

		await conn.beginTransaction();

		const [empRows] = await conn.query('SELECT empleado_id FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1', [empleadoId, empresaId]);
		if (!empRows.length) {
			await conn.rollback();
			return res.status(404).json({ error: 'Empleado no encontrado' });
		}

		// First try treating the param as empleado_concepto_id (filtrar por empresa)
		const [byIdRows] = await conn.query('SELECT empleado_concepto_id FROM empleados_conceptos WHERE empleado_concepto_id = ? AND empleado_id = ? AND empresa_id = ? LIMIT 1', [maybeEmpleadoConceptoId, empleadoId, empresaId]);
		let delResult;
		let removedBy = null;
		let removedId = null;
		if (byIdRows.length) {
			[delResult] = await conn.query('DELETE FROM empleados_conceptos WHERE empleado_concepto_id = ? AND empresa_id = ?', [maybeEmpleadoConceptoId, empresaId]);
			removedBy = 'empleado_concepto_id';
			removedId = maybeEmpleadoConceptoId;
		} else {
			// fallback: treat param as concepto_id
			const conceptoId = maybeEmpleadoConceptoId;
			[delResult] = await conn.query('DELETE FROM empleados_conceptos WHERE empleado_id = ? AND concepto_id = ? AND empresa_id = ?', [empleadoId, conceptoId, empresaId]);
			removedBy = 'concepto_id';
			removedId = conceptoId;
		}

		await conn.commit();

		if (delResult.affectedRows > 0) {
			console.info('quitar concepto', { usuario: usuarioId, empleadoId, removedBy, removedId });
			return res.json({ success: true, removed: removedId, removed_by: removedBy, meta: { empleado_id: empleadoId } });
		}

		return res.json({ success: false, removed: null, message: 'no assigned', meta: { empleado_id: empleadoId } });
	} catch (error) {
		await conn.rollback();
		console.error('empleado conceptos delete error:', error);
		return res.status(500).json({ error: 'Error al quitar concepto' });
	} finally {
		conn.release();
	}
});

	// PATCH actualizar orden de una asignación (empleado_concepto)
	router.patch('/:id/conceptos/:empleadoConceptoId/orden', async (req, res) => {
		const conn = await pool.getConnection();
		try {
			const empresaId = req.user.empresa_id;
			const usuarioId = req.user.usuario_id;
			const empleadoId = parseInt(req.params.id, 10);
			const empleadoConceptoId = parseInt(req.params.empleadoConceptoId, 10);
			const { orden } = req.body;

			if (!Number.isInteger(empleadoId) || empleadoId <= 0) return res.status(400).json({ error: 'empleado_id inválido' });
			if (!Number.isInteger(empleadoConceptoId) || empleadoConceptoId <= 0) return res.status(400).json({ error: 'empleado_concepto_id inválido' });
			if (orden === undefined || orden === null || !Number.isInteger(parseInt(orden, 10))) return res.status(400).json({ error: 'orden inválido' });

			await conn.beginTransaction();

			const [empRows] = await conn.query('SELECT empleado_id FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1', [empleadoId, empresaId]);
			if (!empRows.length) {
				await conn.rollback();
				return res.status(404).json({ error: 'Empleado no encontrado' });
			}

			const [rows] = await conn.query('SELECT empleado_concepto_id FROM empleados_conceptos WHERE empleado_concepto_id = ? AND empleado_id = ? AND empresa_id = ? LIMIT 1', [empleadoConceptoId, empleadoId, empresaId]);
			if (!rows.length) {
				await conn.rollback();
				return res.status(404).json({ error: 'Asignación no encontrada' });
			}

			const [upd] = await conn.query('UPDATE empleados_conceptos SET orden = ? WHERE empleado_concepto_id = ? AND empresa_id = ?', [parseInt(orden, 10), empleadoConceptoId, empresaId]);

			await conn.commit();

			return res.json({ success: true, updated: empleadoConceptoId, orden: parseInt(orden, 10), meta: { empleado_id: empleadoId } });
		} catch (error) {
			await conn.rollback();
			console.error('empleado conceptos update orden error:', error);
			return res.status(500).json({ error: 'Error al actualizar orden' });
		} finally {
			conn.release();
		}
	});

	// POST /api/empleados/asignaciones-masivas
	router.post('/asignaciones-masivas', async (req, res) => {
		const conn = await pool.getConnection();
		try {
			const usuario = req.user;
			const usuarioId = usuario.usuario_id;
			const userEmpresaId = usuario.empresa_id;

						// permiso requerido: verificar que el rol del usuario tenga el permiso con alias 'conceptos_asigna'
						const [permCheck] = await conn.query(
							`SELECT COUNT(*) as cnt
							 FROM rolPermiso rp
							 INNER JOIN permiso p ON p.id = rp.permisoId
							 WHERE rp.rolId = ? AND rp.empresa_id = ? AND p.alias = 'conceptos_asigna' AND rp.estado = 1 AND p.estado = 1`,
							[usuario.rol_id, userEmpresaId]
						);
						if (!permCheck || !permCheck[0] || Number(permCheck[0].cnt) === 0) {
							await conn.release();
							return res.status(403).json({ message: 'Permiso denegado' });
						}

			const payload = req.body || {};
			const empresaId = payload.empresa_id ? Number(payload.empresa_id) : userEmpresaId;
			if (Number(empresaId) !== Number(userEmpresaId)) {
				await conn.release();
				return res.status(403).json({ message: 'empresa_id fuera del scope del usuario' });
			}

			const employeeIds = Array.isArray(payload.employee_ids) ? payload.employee_ids.map((v) => Number(v)).filter(Number.isInteger) : null;
			const filter = payload.filter || null;
			const conceptos = Array.isArray(payload.conceptos) ? payload.conceptos : [];
			// ordenar conceptos por prioridad similar a la asignación puntual
			let conceptosSorted = conceptos;
			try {
				if (conceptos && conceptos.length) {
					const conceptoIdsForOrder = [...new Set(conceptos.map((x) => Number(x.concepto_id)).filter(Number.isInteger))];
					if (conceptoIdsForOrder.length) {
						const ph = conceptoIdsForOrder.map(() => '?').join(',');
						const [prioRows] = await conn.query(
							`SELECT c.concepto_id, COALESCE(ct.prioridad, 0) AS tipo_prioridad
							 FROM conceptos c
							 LEFT JOIN conceptos_tipos ct ON ct.conceptos_tipos_id = c.tipo_concepto_id
							 WHERE c.concepto_id IN (${ph}) AND c.empresa_id = ?`,
							[...conceptoIdsForOrder, empresaId]
						);
						const prioMap = new Map();
						for (const r of prioRows) prioMap.set(Number(r.concepto_id), Number(r.tipo_prioridad) || 0);
						conceptosSorted = conceptos.slice().sort((a, b) => {
							const pa = prioMap.get(Number(a.concepto_id)) || 0;
							const pb = prioMap.get(Number(b.concepto_id)) || 0;
							if (pa !== pb) return pa - pb;
							return Number(a.concepto_id) - Number(b.concepto_id);
						});
					}
				}
			} catch (e) {
				console.error('warning sorting conceptos by priority', e);
				conceptosSorted = conceptos;
			}
			const batchSize = Number.isInteger(Number(payload.batchSize)) ? Number(payload.batchSize) : 200;
			const dryRun = payload.dryRun === true;
			const atomicPerEmployee = payload.atomicPerEmployee !== false;
			const requestedBy = payload.requestedBy ? Number(payload.requestedBy) : usuarioId;

			if (!conceptos.length) {
				await conn.release();
				return res.status(400).json({ message: 'conceptos obligatorio', errors: { conceptos: 'Lista vacía' } });
			}

			// Auditar petición: crear job registro (tabla creada si no existe)
			const jobId = randomUUID();
			try {
				await conn.query(`
					CREATE TABLE IF NOT EXISTS asignaciones_masivas_jobs (
						id CHAR(36) PRIMARY KEY,
						empresa_id BIGINT,
						requested_by BIGINT,
						payload JSON,
						status VARCHAR(20) DEFAULT 'pending',
						summary JSON NULL,
						created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
						finished_at TIMESTAMP NULL
					) ENGINE=InnoDB DEFAULT CHARSET=utf8;
				`);
				await conn.query('INSERT INTO asignaciones_masivas_jobs (id, empresa_id, requested_by, payload, status) VALUES (?, ?, ?, ?, ?)', [jobId, empresaId, requestedBy, JSON.stringify(payload), dryRun ? 'dryrun' : 'running']);
			} catch (e) {
				console.error('warning: no se pudo crear/insert job', e.message || e);
			}

			// Obtener lista de empleados según employeeIds o filtro
			let empleadosList = [];
			if (employeeIds && employeeIds.length) {
				const placeholders = employeeIds.map(() => '?').join(',');
				const [rows] = await conn.query(`SELECT empleado_id, estado AS estado_id FROM empleados WHERE empleado_id IN (${placeholders}) AND empresa_id = ?`, [...employeeIds, empresaId]);
				empleadosList = rows.map((r) => ({ empleado_id: r.empleado_id, estado_id: r.estado_id }));
			} else {
				// construir WHERE desde filter
				const wh = ['empresa_id = ?'];
				const params = [empresaId];
				if (filter) {
					if (filter.sucursal_id && Array.isArray(filter.sucursal_id) && filter.sucursal_id.length) {
						const ph = filter.sucursal_id.map(() => '?').join(',');
						wh.push(`sucursal_id IN (${ph})`);
						params.push(...filter.sucursal_id.map((v) => Number(v)));
					}
					if (filter.seccion_id && Array.isArray(filter.seccion_id) && filter.seccion_id.length) {
						const ph = filter.seccion_id.map(() => '?').join(',');
						wh.push(`seccion_id IN (${ph})`);
						params.push(...filter.seccion_id.map((v) => Number(v)));
					}
					if (filter.tipo_contratacion && Array.isArray(filter.tipo_contratacion) && filter.tipo_contratacion.length) {
						// accept numeric ids only for now
						const ids = filter.tipo_contratacion.map((v) => Number(v)).filter(Number.isInteger);
						if (ids.length) {
							const ph = ids.map(() => '?').join(',');
							wh.push(`tipo_contratacion_id IN (${ph})`);
							params.push(...ids);
						}
					}
					if (filter.q && String(filter.q).trim().length > 0) {
						const term = `%${String(filter.q).trim()}%`;
						wh.push('(numero_documento LIKE ? OR CONCAT(nombre, " ", apellido) LIKE ?)');
						params.push(term, term);
					}
					if (filter.activo !== undefined) {
						if (filter.activo === true) wh.push('estado_id = 1');
						else if (filter.activo === false) wh.push('estado_id != 1');
					}
				}
				const whereSql = wh.length ? `WHERE ${wh.join(' AND ')}` : '';
				const [rows] = await conn.query(`SELECT empleado_id, estado AS estado_id FROM empleados ${whereSql}`, params);
				empleadosList = rows.map((r) => ({ empleado_id: r.empleado_id, estado_id: r.estado_id }));
			}

			const totalRequested = empleadosList.length;
			let processed = 0;
			let succeeded = 0;
			const failures = [];
			const createdBulk = [];
			const updatedBulk = [];

			// process in batches
			for (let i = 0; i < empleadosList.length; i += batchSize) {
				const batch = empleadosList.slice(i, i + batchSize);
				for (const emp of batch) {
					processed += 1;
					const empErrors = [];
					const empId = emp.empleado_id;
					if (emp.estado_id !== undefined && Number(emp.estado_id) !== 1) {
						empErrors.push('Empleado inactivo');
						failures.push({ empleado_id: empId, errors: empErrors });
						continue;
					}

					// transaction per employee if atomicPerEmployee
					if (atomicPerEmployee && !dryRun) await conn.beginTransaction();
					let anyError = false;
					try {
						for (const c of conceptosSorted) {
							const conceptoId = Number(c.concepto_id);
							if (!Number.isInteger(conceptoId) || conceptoId <= 0) {
								empErrors.push('concepto_id inválido');
								anyError = true;
								break;
							}
							// validar concepto y empresa
							const [cRows] = await conn.query('SELECT concepto_id, importe_fijo, es_sueldo_basico, grupo_id, tipo_concepto_id FROM conceptos WHERE concepto_id = ? AND empresa_id = ? LIMIT 1', [conceptoId, empresaId]);
							if (!cRows.length) {
								empErrors.push(`Concepto ${conceptoId} no existe en empresa`);
								anyError = true;
								break;
							}
							const conceptoRow = cRows[0];
							let importeToUse = null;
							// If concept is sueldo_basico, compute importe following the same priority
							// as individual assignment: convenio_categoria.sueldo_basico -> empleados.sueldo_actual ->
							// empleados_salarios (último) -> concepto.importe_fijo -> provided c.importe (override)
							let overrideUsed = false;
							try {
								if (conceptoRow && Number(conceptoRow.es_sueldo_basico) === 1) {
									// convenio_categoria
									const [empCatRows] = await conn.query('SELECT convenio_categoria_id FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1', [empId, empresaId]);
									const empleadoCategoriaId = empCatRows.length ? empCatRows[0].convenio_categoria_id : null;
									if (empleadoCategoriaId) {
										const [ccRows] = await conn.query('SELECT sueldo_basico FROM convenios_categorias WHERE categoria_id = ? LIMIT 1', [empleadoCategoriaId]);
										if (ccRows.length && Number(ccRows[0].sueldo_basico) > 0) {
											importeToUse = Number(ccRows[0].sueldo_basico);
										}
									}

									// sueldo_actual del empleado
									if (importeToUse === null) {
										try {
											const [empSalRows] = await conn.query('SELECT sueldo_actual FROM empleados WHERE empleado_id = ? AND empresa_id = ? LIMIT 1', [empId, empresaId]);
											if (empSalRows.length && Number(empSalRows[0].sueldo_actual) > 0) {
												importeToUse = Number(empSalRows[0].sueldo_actual);
											}
										} catch (e) {
											console.error('error reading empleados.sueldo_actual fallback (bulk):', e);
										}
									}

									// último empleados_salarios
									if (importeToUse === null) {
										try {
											const [lastSalRows] = await conn.query('SELECT monto FROM empleados_salarios WHERE empleado_id = ? AND empresa_id = ? ORDER BY fecha_desde DESC LIMIT 1', [empId, empresaId]);
											if (lastSalRows.length && Number(lastSalRows[0].monto) > 0) {
												importeToUse = Number(lastSalRows[0].monto);
											}
										} catch (e) {
											console.error('error reading empleados_salarios fallback (bulk):', e);
										}
									}
								}
							} catch (e) {
								console.error('error computing sueldo_basico in bulk:', e);
							}

							// final fallbacks: concepto.importe_fijo or provided c.importe as override
							if (importeToUse === null) {
								if (Number(conceptoRow.importe_fijo) > 0) importeToUse = Number(conceptoRow.importe_fijo);
								else if (c.importe !== undefined && c.importe !== null && Number(c.importe) > 0) {
									importeToUse = Number(c.importe);
									overrideUsed = true;
								}
							}

							// validate permiso: if overrideUsed or importe comes from concepto.importe_fijo, ensure group permits importe fijo
							try {
								const permite = await resolvePermiteImporte(empresaId, conceptoRow.grupo_id, conceptoRow.tipo_concepto_id);
								if (overrideUsed && permite === 0) {
									empErrors.push(`El grupo del concepto ${conceptoId} no permite importe fijo (override)`);
									anyError = true;
									break;
								}
								if (!overrideUsed && importeToUse !== null && Number(conceptoRow.importe_fijo) > 0 && permite === 0) {
									// drop the importe coming from concepto.importe_fijo when grupo disallows
									importeToUse = null;
								}
							} catch (e) {
								console.error('permite_importe check in bulk error:', e.message || e);
							}

							const unidades = c.unidades !== undefined && c.unidades !== null ? Number(c.unidades) : 1;
							const fechaAsign = c.fecha_asignacion ? c.fecha_asignacion : null;

							// if this item used a manual override, require razon_override at payload level
							if (overrideUsed && (!payload.razon_override || String(payload.razon_override).trim().length === 0)) {
								empErrors.push('razon_override es obligatoria cuando se provee un importe manual');
								anyError = true;
								break;
							}

							if (!dryRun) {
								const importeParam = importeToUse === null ? null : importeToUse;
								// avoid duplicate: if exists update, otherwise insert
								const [existEC] = await conn.query('SELECT empleado_concepto_id FROM empleados_conceptos WHERE empresa_id = ? AND empleado_id = ? AND concepto_id = ? LIMIT 1', [empresaId, empId, conceptoId]);
								if (existEC.length) {
									const ecId = existEC[0].empleado_concepto_id;
									// read existing importe to decide if sueldo changed
									const [existingRows] = await conn.query('SELECT importe, unidades FROM empleados_conceptos WHERE empleado_concepto_id = ? AND empresa_id = ? LIMIT 1', [ecId, empresaId]);
									const existing = existingRows.length ? existingRows[0] : null;
									const existingImporte = existing && existing.importe !== null && existing.importe !== undefined ? Number(existing.importe) : null;
									const newImporte = importeParam === null || importeParam === undefined ? null : Number(importeParam);
									const importeChanged = (existingImporte === null && newImporte !== null) || (existingImporte !== null && newImporte === null) || (existingImporte !== null && newImporte !== null && existingImporte !== newImporte);

									await conn.query(
										`UPDATE empleados_conceptos SET fecha_asignacion = COALESCE(?, NOW()), operador_codigo = ?, nro_liquidacion = ?, importe = ?, unidades = ? WHERE empleado_concepto_id = ? AND empresa_id = ?`,
										[fechaAsign, requestedBy, null, importeParam, unidades, ecId, empresaId]
									);
									updatedBulk.push({ empleado_concepto_id: ecId, concepto_id: conceptoId, empleado_id: empId });

									// si es sueldo_basico y el importe cambió, sincronizar sueldo
									if (Number(conceptoRow.es_sueldo_basico) === 1 && newImporte !== null && importeChanged) {
										await conn.query('INSERT INTO empleados_salarios (empresa_id, empleado_id, monto, fecha_desde, razon, creado_por) VALUES (?, ?, ?, CURDATE(), ?, ?)', [empresaId, empId, newImporte, 'Asignacion masiva', requestedBy]);
										await conn.query('UPDATE empleados SET sueldo_actual = ? WHERE empleado_id = ?', [newImporte, empId]);
									}
								} else {
									const [ins] = await conn.query(
										`INSERT INTO empleados_conceptos (empresa_id, empleado_id, concepto_id, fecha_asignacion, operador_codigo, nro_liquidacion, importe, unidades)
										 VALUES (?, ?, ?, COALESCE(?, NOW()), ?, ?, ?, ?)`,
										[empresaId, empId, conceptoId, fechaAsign, requestedBy, null, importeParam, unidades]
									);
									createdBulk.push({ empleado_concepto_id: ins.insertId, concepto_id: conceptoId, empleado_id: empId });
								}

								// si es sueldo_basico, sincronizar empleados_salarios y sueldo_actual
								if (Number(conceptoRow.es_sueldo_basico) === 1 && importeParam !== null) {
									const razonToUse = overrideUsed ? `Manual override: ${String(payload.razon_override).slice(0,200)}` : 'Asignacion masiva';
									await conn.query('INSERT INTO empleados_salarios (empresa_id, empleado_id, monto, fecha_desde, razon, creado_por) VALUES (?, ?, ?, CURDATE(), ?, ?)', [empresaId, empId, importeParam, razonToUse, requestedBy]);
									await conn.query('UPDATE empleados SET sueldo_actual = ? WHERE empleado_id = ?', [importeParam, empId]);
								}
							}
						}

						if (anyError) {
							if (atomicPerEmployee && !dryRun) await conn.rollback();
							failures.push({ empleado_id: empId, errors: empErrors });
						} else {
							if (atomicPerEmployee && !dryRun) await conn.commit();
							succeeded += 1;
						}
					} catch (e) {
						if (atomicPerEmployee && !dryRun) await conn.rollback();
						console.error('asignaciones masivas item error:', e.message || e);
						failures.push({ empleado_id: empId, errors: [e.message || 'Error desconocido'] });
					}
				}
			}

			// actualizar job summary
			try {
				await conn.query('UPDATE asignaciones_masivas_jobs SET status = ?, summary = ?, finished_at = NOW() WHERE id = ?', ['completed', JSON.stringify({ requested: totalRequested, processed, succeeded, failed: failures.length }), jobId]);
			} catch (e) {
				console.error('warning updating job record', e.message || e);
			}

			const summary = { requested: totalRequested, processed, succeeded, failed: failures.length };
			const message = dryRun ? 'Preview (dry run) — no se aplicaron cambios' : (failures.length ? 'Procesado con errores parciales' : 'Asignación completada');

			return res.status(200).json({ summary, failures, job_id: jobId, message, created: createdBulk, updated: updatedBulk });
		} catch (error) {
			console.error('asignaciones masivas error:', error);
			return res.status(500).json({ message: 'Error interno al procesar asignaciones masivas' });
		} finally {
			try { await conn.release(); } catch (e) {}
		}
	});

export default router;
