import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = process.env.ZERO_DB_PATH ?? path.join(process.cwd(), "data", "zero.db");

console.log("Database path:", dbPath);

if (!fs.existsSync(dbPath)) {
  console.log("Status: not created yet (will be created on first app start)");
  process.exit(0);
}

const stats = fs.statSync(dbPath);
console.log("File size:", (stats.size / 1024).toFixed(1) + " KB");

const db = new Database(dbPath, { readonly: true });

// Schema version
const version =
  (() => {
    try {
      const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get();
      return row?.v ?? 0;
    } catch {
      return 0;
    }
  })();
console.log("Schema version:", version);

// Table row counts
const tables = [
  "accounts",
  "category_groups",
  "categories",
  "monthly_budgets",
  "transactions",
  "transaction_splits",
  "targets",
  "net_worth_snapshots",
  "payees",
];

console.log("\nRow counts:");
for (const table of tables) {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
    console.log(`  ${table}: ${row.c}`);
  } catch {
    console.log(`  ${table}: (table missing)`);
  }
}

db.close();

// Most recent backup
const backupDir = process.env.ZERO_BACKUP_DIR ?? path.join(path.dirname(dbPath), "backups");
if (fs.existsSync(backupDir)) {
  const backups = fs
    .readdirSync(backupDir)
    .filter((f) => f.endsWith(".db"))
    .sort()
    .reverse();
  if (backups.length > 0) {
    console.log("\nLatest backup:", path.join(backupDir, backups[0]));
  } else {
    console.log("\nNo backups found in", backupDir);
  }
} else {
  console.log("\nNo backups directory at", backupDir);
}
