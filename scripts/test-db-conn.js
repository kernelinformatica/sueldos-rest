// Usage: node scripts/test-db-conn.js <host> <port> <user> <password> <database>
const mysql = require('mysql2/promise');

async function main() {
  const [host, port, user, password, database] = process.argv.slice(2);
  if (!host || !port || !user || !password || !database) {
    console.error('Uso: node scripts/test-db-conn.js <host> <port> <user> <password> <database>');
    process.exit(2);
  }

  let conn;
  try {
    conn = await mysql.createConnection({
      host,
      port: Number(port),
      user,
      password,
      database,
      connectTimeout: 10000,
    });

    const [rows] = await conn.execute('SELECT 1+1 AS result');
    console.log('Conexión OK. Resultado de prueba:', rows[0]);
    await conn.end();
    process.exit(0);
  } catch (err) {
    console.error('Error conectando a MySQL:', err.message || err);
    if (conn && conn.end) await conn.end().catch(()=>{});
    process.exit(1);
  }
}

main();
