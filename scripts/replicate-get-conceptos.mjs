import mysql from 'mysql2/promise';

const [host='10.0.0.33', port='3306', user='root', pass='root', database='sueldos', empleadoId='7'] = process.argv.slice(2);

async function run(){
  let conn;
  try{
    conn = await mysql.createConnection({host, port, user, password: pass, database});
    const [empRows] = await conn.execute('SELECT empleado_id, empresa_id FROM empleados WHERE empleado_id = ? LIMIT 1', [Number(empleadoId)]);
    if(!empRows.length){
      console.error('Empleado no encontrado');
      return;
    }
    const empresaId = empRows[0].empresa_id;
    const [rows] = await conn.execute(
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
 ORDER BY (ec.orden = 0) ASC, ec.orden ASC, ct.prioridad ASC, c.codigo ASC, ec.fecha_asignacion DESC`,
      [Number(empleadoId), Number(empresaId)]
    );
    console.log(JSON.stringify(rows, null, 2));
  }catch(e){
    console.error('error', e.message || e);
  }finally{
    if(conn) await conn.end();
  }
}

run();
