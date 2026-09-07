// Aplica archivos de migración SQL puntuales contra la base configurada en api/.env
// Uso: node scripts/apply-migrations.mjs 005_add_formula_tipo_conceptos.sql 006_....sql
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../api/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, '').trim().length > 0);
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Indique al menos un archivo de db/migrations a aplicar.');
    process.exit(2);
  }

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    if (!fs.existsSync(filePath)) {
      console.error(`No existe: ${filePath}`);
      process.exit(1);
    }
    const sql = fs.readFileSync(filePath, 'utf8');
    const statements = splitStatements(sql);
    console.log(`\n=== ${file} (${statements.length} sentencias) ===`);
    for (const [i, stmt] of statements.entries()) {
      const preview = stmt.replace(/\s+/g, ' ').slice(0, 90);
      try {
        await pool.query(stmt);
        console.log(`  [ok] #${i + 1}: ${preview}...`);
      } catch (err) {
        console.error(`  [FAIL] #${i + 1}: ${preview}...`);
        console.error(`  -> ${err.code || ''} ${err.message}`);
        await pool.end();
        process.exit(1);
      }
    }
  }

  console.log('\nMigraciones aplicadas correctamente.');
  await pool.end();
  process.exit(0);
}

main();
