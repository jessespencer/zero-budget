#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
// Build a transactional SQL batch that inserts bank transactions into Zero's DB,
// mirroring app/(app)/transactions/actions.ts::createTransaction:
//   - INSERT with source='desktop', cleared/approved as given
//   - gated current_balance update (only for rows dated >= budget_start_month cutoff)
//   - payee default-category COALESCE upsert
//
// Account-agnostic: the account name is passed in; the SQL resolves its id by name.
// Money is REAL (floats) by design — we sum raw amounts and let SQLite store the delta.
//
// Usage: build-sql.mjs <accountName> <cutoffISODate> < input.tsv
// TSV columns (tab-separated, no header):
//   date<TAB>payee<TAB>amount<TAB>category<TAB>memo<TAB>cleared<TAB>pending
// Only date, payee, amount are required. category/memo blank => NULL. cleared default 0.
//
// pending (7th col, "1" to mark pending): a not-yet-posted bank line. Inserted with
// approved=0 so it surfaces in the app's pending section, and — crucially — its amount
// is NOT applied to current_balance (a pending line hasn't posted). When the bank later
// posts it, a subsequent reconcile promotes the row via promote.sh (flip approved=1 and
// apply the held amount to the balance then). This keeps current_balance == the
// statement's POSTED balance. pending rows force cleared=0.

const [accountName, cutoff] = process.argv.slice(2);
if (!accountName || !cutoff) {
  console.error("usage: build-sql.mjs <accountName> <cutoffISODate> < input.tsv");
  process.exit(2);
}

const sq = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const acctSub = `(SELECT id FROM accounts WHERE name=${sq(accountName)})`;
const USER = "00000000-0000-0000-0000-000000000000";

const input = readFileSync(0, "utf8");
const rows = input
  .split("\n")
  .map((l) => l.replace(/\r$/, ""))
  .filter((l) => l.trim() && !l.startsWith("#"));

const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
let delta = 0;
const inserts = [];
const payeeUpserts = [];

for (const [i, line] of rows.entries()) {
  const [date, payee, amountRaw, category, memo, cleared, pending] = line.split("\t");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim()))
    throw new Error(`row ${i + 1}: bad/missing ISO date: ${JSON.stringify(date)}`);
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount))
    throw new Error(`row ${i + 1}: bad amount: ${JSON.stringify(amountRaw)}`);
  const d = date.trim();
  const cat = category && category.trim() ? category.trim() : null;
  const catSub = cat ? `(SELECT id FROM categories WHERE name=${sq(cat)})` : "NULL";
  const isPending = pending && pending.trim() === "1";
  // A pending line hasn't posted: force cleared=0 and approved=0.
  const clr = isPending ? 0 : cleared && cleared.trim() === "1" ? 1 : 0;
  const approved = isPending ? 0 : 1;
  const id = randomUUID();

  inserts.push(
    `INSERT INTO transactions (id,user_id,date,payee,memo,amount,account_id,category_id,cleared,approved,source,created_at,updated_at) ` +
      `VALUES (${sq(id)},${sq(USER)},${sq(d)},${sq(payee || null)},${sq(memo || null)},${amount},${acctSub},${catSub},${clr},${approved},'desktop',${sq(ts)},${sq(ts)});`
  );

  // Gated balance: only rows on/after cutoff move current_balance (lib/balance.ts).
  // Pending rows are held OUT of the balance until they post (promote.sh applies
  // them then) — a not-yet-posted line must not shift the reconciled balance.
  if (d >= cutoff && !isPending) delta += amount;

  // Payee upsert, which does double duty: it registers the payee and COALESCEs a
  // default category onto it (never overwriting an existing default).
  //
  // Deliberately NOT gated on `cat`. It used to be, which quietly coupled payee
  // creation to supplying a category: an ALLOW_NEW_PAYEES=1 import of three new
  // payees created only the one that happened to carry a category, and the other
  // two existed solely as denormalized text on their transaction rows — absent
  // from the picker, from payees.sh, and rejected by the next import that named
  // them. `catSub` is already "NULL" when there's no category, so an uncategorized
  // row now registers the payee with no default, and for a payee that already
  // exists the COALESCE makes it a no-op.
  if (payee && payee.trim()) {
    payeeUpserts.push(
      `INSERT INTO payees (id,user_id,name,default_category_id) VALUES (${sq(randomUUID())},${sq(USER)},${sq(payee.trim())},${catSub}) ` +
        `ON CONFLICT(user_id,name) DO UPDATE SET default_category_id = COALESCE(payees.default_category_id, excluded.default_category_id);`
    );
  }
}

const out = [];
out.push("BEGIN;");
out.push(...inserts);
out.push(...payeeUpserts);
if (delta !== 0) {
  // Round the accumulated delta to cents only at the final write (never intermediate).
  const rounded = Math.round(delta * 100) / 100;
  out.push(`UPDATE accounts SET current_balance = current_balance + (${rounded}) WHERE id=${acctSub};`);
}
out.push("COMMIT;");
out.push(`SELECT 'inserted', ${rows.length};`);
out.push(`SELECT 'new_balance', printf('%.2f', current_balance) FROM accounts WHERE id=${acctSub};`);
process.stdout.write(out.join("\n") + "\n");
