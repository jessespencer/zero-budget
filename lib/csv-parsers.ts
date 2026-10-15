export type ParsedTransaction = {
  date: string;
  payee: string;
  amount: number; // negative = expense, positive = income
  memo?: string;
  account?: string; // per-row account name (e.g. YNAB Account column)
  category?: string; // per-row category name (e.g. YNAB Category column)
};

type BankParser = {
  name: string;
  detect: (headers: string[]) => boolean;
  parse: (headers: string[], rows: string[][]) => ParsedTransaction[];
};

export type ColumnMapping = {
  date: number;
  payee: number;
  amount: number;
  memo?: number;
  flipSign?: boolean; // true if bank uses positive for expenses
};

// --- Bank parsers ---

/** Strip $ and commas from a money string before parseFloat. */
const parseMoney = (s: string): number =>
  parseFloat((s || "").replace(/[$,]/g, "")) || 0;

const ynabParser: BankParser = {
  name: "YNAB",
  detect: (headers) =>
    headers.some((h) => h.toLowerCase() === "account") &&
    headers.some((h) => h.toLowerCase() === "outflow") &&
    headers.some((h) => h.toLowerCase() === "inflow") &&
    headers.some((h) => h.toLowerCase() === "category"),
  parse: (headers, rows) => {
    const acctIdx = headers.findIndex((h) => h.toLowerCase() === "account");
    const dateIdx = headers.findIndex((h) => h.toLowerCase() === "date");
    const payeeIdx = headers.findIndex((h) => h.toLowerCase() === "payee");
    const catIdx = headers.findIndex((h) => h.toLowerCase() === "category");
    const memoIdx = headers.findIndex((h) => h.toLowerCase() === "memo");
    const outflowIdx = headers.findIndex((h) => h.toLowerCase() === "outflow");
    const inflowIdx = headers.findIndex((h) => h.toLowerCase() === "inflow");

    return rows.map((row) => {
      const outflow = parseMoney(row[outflowIdx]);
      const inflow = parseMoney(row[inflowIdx]);
      return {
        date: normalizeDate(row[dateIdx]),
        payee: row[payeeIdx] ?? "",
        amount: roundCents(inflow - outflow),
        memo: row[memoIdx] || undefined,
        account: row[acctIdx] || undefined,
        category: row[catIdx] || undefined,
      };
    });
  },
};

const chaseParser: BankParser = {
  name: "Chase",
  detect: (headers) =>
    headers.some((h) => h.toLowerCase().includes("transaction date")) &&
    headers.some((h) => h.toLowerCase() === "type"),
  parse: (headers, rows) => {
    const dateIdx = headers.findIndex((h) => h.toLowerCase().includes("transaction date"));
    const descIdx = headers.findIndex((h) => h.toLowerCase() === "description");
    const amountIdx = headers.findIndex((h) => h.toLowerCase() === "amount");
    const memoIdx = headers.findIndex((h) => h.toLowerCase() === "memo");

    return rows.map((row) => ({
      date: normalizeDate(row[dateIdx]),
      payee: row[descIdx] ?? "",
      amount: roundCents(parseFloat(row[amountIdx]) || 0),
      memo: row[memoIdx] || undefined,
    }));
  },
};

const capitalOneParser: BankParser = {
  name: "Capital One",
  detect: (headers) =>
    headers.some((h) => h.toLowerCase().includes("transaction date")) &&
    (headers.some((h) => h.toLowerCase() === "debit") ||
      headers.some((h) => h.toLowerCase() === "credit")),
  parse: (headers, rows) => {
    const dateIdx = headers.findIndex((h) => h.toLowerCase().includes("transaction date"));
    const descIdx = headers.findIndex((h) => h.toLowerCase() === "description");
    const debitIdx = headers.findIndex((h) => h.toLowerCase() === "debit");
    const creditIdx = headers.findIndex((h) => h.toLowerCase() === "credit");

    return rows.map((row) => {
      const debit = parseFloat(row[debitIdx]) || 0;
      const credit = parseFloat(row[creditIdx]) || 0;
      return {
        date: normalizeDate(row[dateIdx]),
        payee: row[descIdx] ?? "",
        amount: credit > 0 ? credit : -debit,
      };
    });
  },
};

const elevationsParser: BankParser = {
  name: "Elevations",
  detect: (headers) =>
    headers.some((h) => h.toLowerCase() === "date") &&
    headers.some((h) => h.toLowerCase() === "balance"),
  parse: (headers, rows) => {
    const dateIdx = headers.findIndex((h) => h.toLowerCase() === "date");
    const descIdx = headers.findIndex((h) => h.toLowerCase() === "description");
    const debitIdx = headers.findIndex((h) => h.toLowerCase() === "debit");
    const creditIdx = headers.findIndex((h) => h.toLowerCase() === "credit");

    return rows.map((row) => {
      const debit = parseFloat(row[debitIdx]) || 0;
      const credit = parseFloat(row[creditIdx]) || 0;
      return {
        date: normalizeDate(row[dateIdx]),
        payee: row[descIdx] ?? "",
        amount: roundCents(credit > 0 ? credit : -debit),
      };
    });
  },
};

const discoverParser: BankParser = {
  name: "Discover",
  detect: (headers) =>
    headers.some((h) => h.toLowerCase().includes("trans. date")) &&
    headers.some((h) => h.toLowerCase() === "description"),
  parse: (headers, rows) => {
    const dateIdx = headers.findIndex((h) => h.toLowerCase().includes("trans. date"));
    const descIdx = headers.findIndex((h) => h.toLowerCase() === "description");
    const amountIdx = headers.findIndex((h) => h.toLowerCase() === "amount");

    return rows.map((row) => ({
      date: normalizeDate(row[dateIdx]),
      payee: row[descIdx] ?? "",
      amount: roundCents(-(parseFloat(row[amountIdx]) || 0)), // Discover: positive = charge
    }));
  },
};

const bankOfAmericaParser: BankParser = {
  name: "Bank of America",
  detect: (headers) =>
    headers.some((h) => h.toLowerCase() === "date") &&
    headers.some((h) => h.toLowerCase() === "description") &&
    headers.some((h) => h.toLowerCase() === "amount") &&
    headers.some((h) => h.toLowerCase() === "running bal."),
  parse: (headers, rows) => {
    const dateIdx = headers.findIndex((h) => h.toLowerCase() === "date");
    const descIdx = headers.findIndex((h) => h.toLowerCase() === "description");
    const amountIdx = headers.findIndex((h) => h.toLowerCase() === "amount");

    return rows.map((row) => ({
      date: normalizeDate(row[dateIdx]),
      payee: row[descIdx] ?? "",
      amount: roundCents(parseFloat(row[amountIdx]) || 0),
    }));
  },
};

const wellsFargoParser: BankParser = {
  name: "Wells Fargo",
  detect: (headers) => {
    // Wells Fargo sometimes has no headers — first field looks like a date
    if (headers.length >= 4 && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(headers[0])) return true;
    return headers.some((h) => h.toLowerCase() === "date") &&
      headers.some((h) => h.toLowerCase() === "amount");
  },
  parse: (headers, rows) => {
    // Check if headers are actually a data row (no header row)
    const hasHeaders = !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(headers[0]);
    const allRows = hasHeaders ? rows : [headers, ...rows];

    if (hasHeaders) {
      const dateIdx = headers.findIndex((h) => h.toLowerCase() === "date");
      const descIdx = headers.findIndex((h) => h.toLowerCase() === "description");
      const amountIdx = headers.findIndex((h) => h.toLowerCase() === "amount");
      return allRows.map((row) => ({
        date: normalizeDate(row[dateIdx]),
        payee: row[descIdx] ?? "",
        amount: roundCents(parseFloat(row[amountIdx]) || 0),
      }));
    }

    // No headers: columns are Date, Amount, *, *, Description
    return allRows.map((row) => ({
      date: normalizeDate(row[0]),
      payee: row[4] ?? "",
      amount: roundCents(parseFloat(row[1]) || 0),
    }));
  },
};

const amexParser: BankParser = {
  name: "American Express",
  detect: (headers) =>
    headers.some((h) => h.toLowerCase() === "date") &&
    headers.some((h) => h.toLowerCase() === "description") &&
    headers.some((h) => h.toLowerCase() === "amount") &&
    headers.some((h) => h.toLowerCase() === "extended details"),
  parse: (headers, rows) => {
    const dateIdx = headers.findIndex((h) => h.toLowerCase() === "date");
    const descIdx = headers.findIndex((h) => h.toLowerCase() === "description");
    const amountIdx = headers.findIndex((h) => h.toLowerCase() === "amount");

    return rows.map((row) => ({
      date: normalizeDate(row[dateIdx]),
      payee: row[descIdx] ?? "",
      amount: roundCents(-(parseFloat(row[amountIdx]) || 0)), // Amex: positive = charge
    }));
  },
};

const allyParser: BankParser = {
  name: "Ally",
  detect: (headers) =>
    headers.some((h) => h.toLowerCase() === "date") &&
    headers.some((h) => h.toLowerCase() === "description") &&
    headers.some((h) => h.toLowerCase() === "amount") &&
    headers.some((h) => h.toLowerCase() === "balance"),
  parse: (headers, rows) => {
    const dateIdx = headers.findIndex((h) => h.toLowerCase() === "date");
    const descIdx = headers.findIndex((h) => h.toLowerCase() === "description");
    const amountIdx = headers.findIndex((h) => h.toLowerCase() === "amount");

    return rows.map((row) => ({
      date: normalizeDate(row[dateIdx]),
      payee: row[descIdx] ?? "",
      amount: roundCents(parseFloat(row[amountIdx]) || 0),
    }));
  },
};

const usaaParser: BankParser = {
  name: "USAA",
  detect: (headers) =>
    headers.some((h) => h.toLowerCase() === "date") &&
    headers.some((h) => h.toLowerCase() === "description") &&
    headers.some((h) => h.toLowerCase() === "original description"),
  parse: (headers, rows) => {
    const dateIdx = headers.findIndex((h) => h.toLowerCase() === "date");
    const descIdx = headers.findIndex((h) => h.toLowerCase() === "original description");
    const amountIdx = headers.findIndex((h) => h.toLowerCase() === "amount");

    return rows.map((row) => ({
      date: normalizeDate(row[dateIdx]),
      payee: row[descIdx] ?? "",
      amount: roundCents(parseFloat(row[amountIdx]) || 0),
    }));
  },
};

const parsers = [
  ynabParser,
  chaseParser,
  capitalOneParser,
  elevationsParser,
  discoverParser,
  bankOfAmericaParser,
  wellsFargoParser,
  amexParser,
  allyParser,
  usaaParser,
];

// --- Main parse function ---

export type ParseResult =
  | { bank: string; transactions: ParsedTransaction[] }
  | { needsMapping: true; headers: string[]; rows: string[][] }
  | { error: string };

export function parseCSV(content: string): ParseResult {
  const lines = splitCSVRecords(content);
  if (lines.length < 2) return { error: "File is empty or has no data rows" };

  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(parseCSVLine).filter((r) => r.length > 1);

  const parser = parsers.find((p) => p.detect(headers));
  if (!parser) {
    // Return raw data for manual field mapping
    return { needsMapping: true, headers, rows };
  }

  const transactions = parser.parse(headers, rows).filter((t) => t.payee || t.amount !== 0);
  return { bank: parser.name, transactions };
}

// --- Generic mapping parser ---

export function parseWithMapping(
  headers: string[],
  rows: string[][],
  mapping: ColumnMapping
): ParsedTransaction[] {
  return rows
    .map((row) => {
      const rawAmount = roundCents(parseFloat(row[mapping.amount]?.replace(/[^0-9.\-]/g, "")) || 0);
      return {
        date: normalizeDate(row[mapping.date] ?? ""),
        payee: row[mapping.payee] ?? "",
        amount: mapping.flipSign ? -rawAmount : rawAmount,
        memo: mapping.memo !== undefined ? row[mapping.memo] || undefined : undefined,
      };
    })
    .filter((t) => t.payee || t.amount !== 0);
}

/** Round to 2 decimal places to avoid IEEE-754 float drift on dollar amounts */
const roundCents = (n: number): number => Math.round(n * 100) / 100;

// --- Utilities ---

/**
 * Split a CSV file into records, treating a newline inside a quoted field as part of
 * the value rather than a record break (RFC-4180 §2.6).
 *
 * A plain `content.split("\n")` tears a wrapped description in half. The leading half
 * keeps the date and payee but loses its amount column, so it parses to $0.00 and
 * imports as a real zero-dollar transaction; the trailing half is unparseable and gets
 * dropped, taking the actual amount with it. Net effect is a silently vanished charge —
 * and like the duplicate flag, it only ever errs toward a too-optimistic balance.
 *
 * Handles CRLF and a trailing newline; blank records are skipped by the caller's filter.
 */
export function splitCSVRecords(content: string): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      // A doubled "" inside a quoted field is a literal quote, not a delimiter —
      // consume both so the quote state stays correct. parseCSVLine unescapes it.
      if (inQuotes && content[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += char;
      }
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && content[i + 1] === "\n") i++;
      records.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  records.push(current);

  return records.map((r) => r.trim()).filter(Boolean);
}

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      // RFC-4180 escaped quote: a doubled "" inside a quoted field is a literal
      // double-quote. Emit one and skip the second so values exported by Zero's
      // own serializer (lib/csv-export.ts) round-trip intact.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10);

  // Try MM/DD/YYYY
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
  }

  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  // Try M/D/YY
  const shortMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (shortMatch) {
    const year = Number(shortMatch[3]) > 50 ? `19${shortMatch[3]}` : `20${shortMatch[3]}`;
    return `${year}-${shortMatch[1].padStart(2, "0")}-${shortMatch[2].padStart(2, "0")}`;
  }

  // Fallback
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}
