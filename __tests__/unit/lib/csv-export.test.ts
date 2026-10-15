import { describe, it, expect } from "vitest";
import { transactionsToCsv } from "@/lib/csv-export";
import { parseCSV, type ParseResult } from "@/lib/csv-parsers";
import type { TransactionWithDetails } from "@/lib/types";

// Build a TransactionWithDetails with sane defaults; override the bits a test
// cares about. Only the fields the serializer reads matter for these assertions.
function tx(overrides: Partial<TransactionWithDetails> = {}): TransactionWithDetails {
  return {
    id: "t1",
    user_id: "u1",
    account_id: "a1",
    date: "2026-05-01",
    payee: "Coffee shop",
    memo: null,
    amount: -4.5,
    category_id: "c1",
    transfer_account_id: null,
    cleared: false,
    approved: true,
    is_split_parent: false,
    is_envelope_movement: false,
    source: "desktop",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    account_name: "Checking",
    category_name: "Dining out",
    category_group_name: "Everyday",
    ...overrides,
  };
}

const HEADER = "Account,Date,Payee,Category,Memo,Outflow,Inflow";

// Split the CSV into rows on the RFC-4180 CRLF separator, dropping the trailing
// blank produced by the trailing newline.
function rows(csv: string): string[] {
  return csv.split("\r\n").filter((l) => l.length > 0);
}

function expectTransactions(result: ParseResult) {
  expect("transactions" in result).toBe(true);
  return "transactions" in result ? result.transactions : [];
}

describe("transactionsToCsv — header", () => {
  it("emits the YNAB-shaped header so the importer auto-detects it", () => {
    const csv = transactionsToCsv([tx()]);
    expect(rows(csv)[0]).toBe(HEADER);
  });

  it("uses CRLF line endings and a trailing newline", () => {
    const csv = transactionsToCsv([tx()]);
    expect(csv.endsWith("\r\n")).toBe(true);
    // header + one data row + trailing => 2 non-empty rows
    expect(rows(csv)).toHaveLength(2);
  });

  it("does not start with a UTF-8 BOM", () => {
    const csv = transactionsToCsv([tx()]);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe("transactionsToCsv — outflow/inflow split", () => {
  it("puts a negative amount in Outflow and leaves Inflow empty", () => {
    const csv = transactionsToCsv([tx({ amount: -4.5 })]);
    expect(rows(csv)[1]).toBe("Checking,2026-05-01,Coffee shop,Dining out,,4.5,");
  });

  it("puts a positive amount in Inflow and leaves Outflow empty", () => {
    const csv = transactionsToCsv([
      tx({ amount: 1200, payee: "Paycheck", category_name: "Income" }),
    ]);
    expect(rows(csv)[1]).toBe("Checking,2026-05-01,Paycheck,Income,,,1200");
  });

  it("treats a zero amount as Inflow 0, Outflow empty", () => {
    const csv = transactionsToCsv([tx({ amount: 0 })]);
    expect(rows(csv)[1]).toBe("Checking,2026-05-01,Coffee shop,Dining out,,,0");
  });

  it("applies roundCents only at the serialization boundary (12.005 -> 12.01)", () => {
    const csv = transactionsToCsv([tx({ amount: 12.005 })]);
    expect(rows(csv)[1]).toBe("Checking,2026-05-01,Coffee shop,Dining out,,,12.01");
  });

  it("rounds an outflow at the boundary too (-12.005 -> 12.01)", () => {
    const csv = transactionsToCsv([tx({ amount: -12.005 })]);
    expect(rows(csv)[1]).toBe("Checking,2026-05-01,Coffee shop,Dining out,,12.01,");
  });
});

describe("transactionsToCsv — null fields", () => {
  it("emits empty Payee/Category/Memo when those are null", () => {
    const csv = transactionsToCsv([
      tx({ payee: null, category_name: null, memo: null }),
    ]);
    expect(rows(csv)[1]).toBe("Checking,2026-05-01,,,,4.5,");
  });

  it("emits the memo when present", () => {
    const csv = transactionsToCsv([tx({ memo: "tip included" })]);
    expect(rows(csv)[1]).toBe(
      "Checking,2026-05-01,Coffee shop,Dining out,tip included,4.5,"
    );
  });
});

describe("transactionsToCsv — RFC-4180 quoting", () => {
  it("quotes a payee containing a comma", () => {
    const csv = transactionsToCsv([tx({ payee: "Smith, Jones & Co" })]);
    expect(rows(csv)[1]).toBe(
      'Checking,2026-05-01,"Smith, Jones & Co",Dining out,,4.5,'
    );
  });

  it("doubles and quotes a memo containing a double-quote", () => {
    const csv = transactionsToCsv([tx({ memo: 'say "hi"' })]);
    expect(rows(csv)[1]).toBe(
      'Checking,2026-05-01,Coffee shop,Dining out,"say ""hi""",4.5,'
    );
  });

  it("quotes a field containing a newline", () => {
    const csv = transactionsToCsv([tx({ memo: "line1\nline2" })]);
    expect(rows(csv)[1]).toContain('"line1\nline2"');
  });

  it("leaves a plain field bare (no unnecessary quoting)", () => {
    const csv = transactionsToCsv([tx({ payee: "Plain" })]);
    expect(rows(csv)[1]).toBe("Checking,2026-05-01,Plain,Dining out,,4.5,");
  });
});

describe("transactionsToCsv — transfer pairs", () => {
  it("emits two rows for a transfer pair (one per leg, as stored)", () => {
    const legOut = tx({
      id: "leg-out",
      account_id: "a1",
      account_name: "Checking",
      transfer_account_id: "a2",
      payee: "Transfer to Savings",
      category_name: null,
      amount: -100,
    });
    const legIn = tx({
      id: "leg-in",
      account_id: "a2",
      account_name: "Savings",
      transfer_account_id: "a1",
      payee: "Transfer from Checking",
      category_name: null,
      amount: 100,
    });
    const csv = transactionsToCsv([legOut, legIn]);
    const dataRows = rows(csv).slice(1);
    expect(dataRows).toHaveLength(2);
    expect(dataRows[0]).toBe(
      "Checking,2026-05-01,Transfer to Savings,,,100,"
    );
    expect(dataRows[1]).toBe(
      "Savings,2026-05-01,Transfer from Checking,,,,100"
    );
  });
});

describe("transactionsToCsv — input order preserved", () => {
  it("emits one row per input transaction in input order", () => {
    const csv = transactionsToCsv([
      tx({ id: "1", payee: "First", amount: -1 }),
      tx({ id: "2", payee: "Second", amount: -2 }),
      tx({ id: "3", payee: "Third", amount: -3 }),
    ]);
    const dataRows = rows(csv).slice(1);
    expect(dataRows.map((r) => r.split(",")[2])).toEqual(["First", "Second", "Third"]);
  });
});

describe("transactionsToCsv — round-trip through parseCSV", () => {
  it("re-imports a plain row reproducing date/payee/amount/memo/account/category", () => {
    const original = tx({
      date: "2026-05-03",
      payee: "Grocery",
      category_name: "Groceries",
      memo: "weekly",
      account_name: "Checking",
      amount: -54.32,
    });
    const result = parseCSV(transactionsToCsv([original]));
    const parsed = expectTransactions(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      date: "2026-05-03",
      payee: "Grocery",
      amount: -54.32,
      memo: "weekly",
      account: "Checking",
      category: "Groceries",
    });
  });

  it("round-trips a comma-containing payee intact", () => {
    const original = tx({ payee: "Smith, Jones & Co", amount: -10, category_name: "Dining out" });
    const result = parseCSV(transactionsToCsv([original]));
    const parsed = expectTransactions(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].payee).toBe("Smith, Jones & Co");
    expect(parsed[0].amount).toBe(-10);
    expect(parsed[0].category).toBe("Dining out");
  });

  it("round-trips a quote-containing payee intact", () => {
    const original = tx({ payee: 'The "Best" Cafe', amount: -7.5, category_name: "Dining out" });
    const result = parseCSV(transactionsToCsv([original]));
    const parsed = expectTransactions(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].payee).toBe('The "Best" Cafe');
    expect(parsed[0].amount).toBe(-7.5);
    expect(parsed[0].category).toBe("Dining out");
  });

  it("round-trips a positive (inflow) amount", () => {
    const original = tx({ payee: "Refund", amount: 25.99, category_name: "Income" });
    const result = parseCSV(transactionsToCsv([original]));
    const parsed = expectTransactions(result);
    expect(parsed[0].amount).toBe(25.99);
  });
});
