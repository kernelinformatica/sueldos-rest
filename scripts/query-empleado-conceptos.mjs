import mysql from 'mysql2/promise';

const [host='10.0.0.33', port='3306', user='root', pass='root', database='sueldos', empleadoId='7', conceptoId='1'] = process.argv.slice(2);

async function run(){
  let conn;
  try{
    conn = await mysql.createConnection({host, port, user, password: pass, database});
    const [rows] = await conn.execute(
      `SELECT empleado_concepto_id, empleado_id, concepto_id, importe, fecha_asignacion
       FROM empleados_conceptos
       WHERE empleado_id = ? AND concepto_id = ?
       ORDER BY fecha_asignacion DESC
       LIMIT 10`,
      [Number(empleadoId), Number(conceptoId)]
    );
    console.log(JSON.stringify(rows, null, 2));
  }catch(e){
    console.error('query error', e.message || e);
    process.exitCode = 2;
  }finally{
    if(conn) await conn.end();
  }
}

run();
