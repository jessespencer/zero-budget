import { roundCents } from "@/lib/db-utils";
import type { TransactionWithDetails } from "@/lib/types";

/**
 * Serialize transactions to an import-compatible CSV string.
 *
 * The header is the YNAB shape (`Account,Date,Payee,Category,Memo,Outflow,Inflow`)
 * so the existing CSV importer (lib/csv-parsers.ts) auto-detects it and a Zero
 * export round-trips back through import without manual column mapping. This
 * closes the data-portability loop: users own their data and can leave with it.
 *
 * Rules:
 * - One row per input transaction, in input order (the caller passes the
 *   already filtered/searched/sorted visible set). Transfer pairs are two
 *   separate input rows and stay two rows — no collapsing.
 * - Money is rounded via roundCents ONLY at this serialization boundary, never
 *   before, and emitted as a plain decimal (no "$"). amount < 0 -> Outflow,
 *   amount >= 0 -> Inflow.
 * - Dates are emitted as-is (already ISO YYYY-MM-DD in the DB).
 * - RFC-4180 quoting on text fields; CRLF row separator; trailing newline; no BOM.
 */

const HEADER = "Account,Date,Payee,Category,Memo,Outflow,Inflow";

/**
 * RFC-4180 field quoting. A field is wrapped in double-quotes iff it contains a
 * comma, double-quote, CR, or LF; embedded double-quotes are doubled (""). A
 * field with no special characters is emitted bare.
 */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Split a signed amount into [outflow, inflow] decimal strings. roundCents is
 * applied here and only here. A negative amount becomes a positive Outflow with
 * an empty Inflow; zero or positive becomes an Inflow with an empty Outflow.
 */
function csvAmount(amount: number): [outflow: string, inflow: string] {
  if (amount < 0) {
    return [String(roundCents(-amount)), ""];
  }
  return ["", String(roundCents(amount))];
}

export function transactionsToCsv(rows: TransactionWithDetails[]): string {
  const lines = [HEADER];

  for (const row of rows) {
    const [outflow, inflow] = csvAmount(Number(row.amount));
    const fields = [
      csvField(row.account_name),
      csvField(row.date),
      csvField(row.payee ?? ""),
      csvField(row.category_name ?? ""),
      csvField(row.memo ?? ""),
      csvField(outflow),
      csvField(inflow),
    ];
    lines.push(fields.join(","));
  }

  // CRLF between rows + trailing newline (RFC-4180).
  return lines.join("\r\n") + "\r\n";
}
