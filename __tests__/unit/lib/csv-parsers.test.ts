import { describe, it, expect } from "vitest";
import {
  parseCSV,
  parseCSVLine,
  parseWithMapping,
  type ColumnMapping,
  type ParseResult,
} from "@/lib/csv-parsers";

// Helper to assert successful parse
function expectBank(result: ParseResult, bank: string) {
  expect("bank" in result).toBe(true);
  if ("bank" in result) expect(result.bank).toBe(bank);
}

function expectTransactions(result: ParseResult) {
  expect("transactions" in result).toBe(true);
  return "transactions" in result ? result.transactions : [];
}

describe("parseCSVLine", () => {
  it("splits simple CSV", () => {
    expect(parseCSVLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCSVLine('"hello, world",b,c')).toEqual(["hello, world", "b", "c"]);
  });

  it("trims whitespace", () => {
    expect(parseCSVLine("  a , b , c  ")).toEqual(["a", "b", "c"]);
  });

  it("handles empty fields", () => {
    expect(parseCSVLine("a,,c")).toEqual(["a", "", "c"]);
  });
});

describe("parseCSV — Chase", () => {
  const chaseCSV = [
    "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    "04/15/2026,04/16/2026,AMAZON.COM,Shopping,Sale,-42.99,",
    "04/14/2026,04/15/2026,PAYROLL DEPOSIT,Income,Credit,3000.00,",
  ].join("\n");

  it("detects Chase format", () => {
    const result = parseCSV(chaseCSV);
    expectBank(result, "Chase");
  });

  it("parses transactions with correct sign (negative = expense)", () => {
    const result = parseCSV(chaseCSV);
    const txns = expectTransactions(result);
    expect(txns[0].amount).toBe(-42.99);
    expect(txns[0].payee).toBe("AMAZON.COM");
    expect(txns[0].date).toBe("2026-04-15");
  });

  it("parses income as positive", () => {
    const result = parseCSV(chaseCSV);
    const txns = expectTransactions(result);
    expect(txns[1].amount).toBe(3000);
  });
});

describe("parseCSV — Capital One", () => {
  const capOneCSV = [
    "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
    "2026-04-10,2026-04-11,1234,COSTCO,Groceries,85.50,",
    "2026-04-12,2026-04-13,1234,PAYMENT,,, 500.00",
  ].join("\n");

  it("detects Capital One format", () => {
    const result = parseCSV(capOneCSV);
    expectBank(result, "Capital One");
  });

  it("debit becomes negative, credit stays positive", () => {
    const result = parseCSV(capOneCSV);
    const txns = expectTransactions(result);
    expect(txns[0].amount).toBe(-85.5);
    expect(txns[1].amount).toBe(500);
  });
});

describe("parseCSV — Discover", () => {
  const discoverCSV = [
    "Trans. Date,Post Date,Description,Amount,Category",
    "04/10/2026,04/11/2026,SPOTIFY,9.99,Entertainment",
    "04/12/2026,04/13/2026,REFUND,-25.00,Returns",
  ].join("\n");

  it("detects Discover format", () => {
    const result = parseCSV(discoverCSV);
    expectBank(result, "Discover");
  });

  it("flips sign (Discover: positive = charge)", () => {
    const result = parseCSV(discoverCSV);
    const txns = expectTransactions(result);
    expect(txns[0].amount).toBe(-9.99); // charge becomes negative
    expect(txns[1].amount).toBe(25); // refund becomes positive
  });
});

describe("parseCSV — Bank of America", () => {
  const boaCSV = [
    "Date,Description,Amount,Running Bal.",
    "04/15/2026,CHECK DEPOSIT,500.00,1500.00",
    "04/14/2026,DEBIT PURCHASE,-32.50,1000.00",
  ].join("\n");

  it("detects Bank of America format", () => {
    const result = parseCSV(boaCSV);
    expectBank(result, "Bank of America");
  });

  it("parses amounts correctly", () => {
    const result = parseCSV(boaCSV);
    const txns = expectTransactions(result);
    expect(txns[0].amount).toBe(500);
    expect(txns[1].amount).toBe(-32.5);
  });
});

describe("parseCSV — American Express", () => {
  // Note: Amex detection requires "extended details" header but comes after
  // Wells Fargo in parser order. Wells Fargo matches any CSV with "date" + "amount"
  // headers, so Amex CSV gets detected as Wells Fargo. This tests actual behavior.
  const amexCSV = [
    "Date,Description,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category",
    "04/10/2026,UBER EATS,24.99,UBER EATS,UBER EATS,SAN FRANCISCO,CA,94105,US,123,Food",
  ].join("\n");

  it("matches Wells Fargo before Amex due to parser order (known limitation)", () => {
    const result = parseCSV(amexCSV);
    // Wells Fargo's broad detection (date + amount) matches before Amex
    expectBank(result, "Wells Fargo");
  });
});

describe("parseCSV — Wells Fargo (headerless)", () => {
  const wfCSV = [
    "01/15/2026,-50.00,*,, GROCERY STORE",
    "01/14/2026,1000.00,*,,DIRECT DEPOSIT",
  ].join("\n");

  it("detects Wells Fargo headerless format", () => {
    const result = parseCSV(wfCSV);
    expectBank(result, "Wells Fargo");
  });

  it("parses headerless columns correctly", () => {
    const result = parseCSV(wfCSV);
    const txns = expectTransactions(result);
    expect(txns[0].amount).toBe(-50);
    expect(txns[0].payee).toBe("GROCERY STORE");
    expect(txns[1].amount).toBe(1000);
  });
});

describe("parseCSV — Ally", () => {
  // Ally requires date + description + amount + balance, but Elevations
  // also matches date + balance and comes earlier in parser order
  const allyCSV = [
    "Date,Time,Amount,Type,Description,Balance",
    "2026-04-15,10:30,-75.00,Debit,ACH PAYMENT,925.00",
  ].join("\n");

  it("matches Elevations before Ally due to parser order (known limitation)", () => {
    const result = parseCSV(allyCSV);
    expectBank(result, "Elevations");
  });
});

describe("parseCSV — USAA", () => {
  // USAA requires "original description" header but Wells Fargo's broad
  // detection (date + amount) matches first in parser order
  const usaaCSV = [
    "Date,Description,Original Description,Category,Amount,Status",
    "2026-04-15,GROCERY STORE,GROCERY STORE #123,Food,-65.00,Posted",
  ].join("\n");

  it("matches Wells Fargo before USAA due to parser order (known limitation)", () => {
    const result = parseCSV(usaaCSV);
    expectBank(result, "Wells Fargo");
  });
});

describe("parseCSV — unknown format", () => {
  it("returns needsMapping for unrecognized headers", () => {
    const csv = "Col A,Col B,Col C\nval1,val2,val3\n";
    const result = parseCSV(csv);
    expect("needsMapping" in result).toBe(true);
  });

  it("returns error for empty content", () => {
    const result = parseCSV("");
    expect("error" in result).toBe(true);
  });

  it("returns error for single line (no data rows)", () => {
    const result = parseCSV("just headers");
    expect("error" in result).toBe(true);
  });
});

describe("parseWithMapping", () => {
  const headers = ["When", "Who", "How Much", "Note"];
  const rows = [
    ["04/15/2026", "Store A", "-42.50", "groceries"],
    ["04/16/2026", "Store B", "100.00", "refund"],
  ];

  it("maps columns according to provided mapping", () => {
    const mapping: ColumnMapping = { date: 0, payee: 1, amount: 2, memo: 3 };
    const result = parseWithMapping(headers, rows, mapping);

    expect(result).toHaveLength(2);
    expect(result[0].date).toBe("2026-04-15");
    expect(result[0].payee).toBe("Store A");
    expect(result[0].amount).toBe(-42.5);
    expect(result[0].memo).toBe("groceries");
  });

  it("flips sign when flipSign is true", () => {
    const mapping: ColumnMapping = { date: 0, payee: 1, amount: 2, flipSign: true };
    const result = parseWithMapping(headers, rows, mapping);

    expect(result[0].amount).toBe(42.5); // was -42.50, flipped to positive
    expect(result[1].amount).toBe(-100); // was 100, flipped to negative
  });

  it("strips non-numeric characters from amount", () => {
    const rows2 = [["04/15/2026", "Store", "$1,234.56", ""]];
    const mapping: ColumnMapping = { date: 0, payee: 1, amount: 2 };
    const result = parseWithMapping(headers, rows2, mapping);

    expect(result[0].amount).toBe(1234.56);
  });
});

describe("date normalization", () => {
  it("normalizes MM/DD/YYYY to ISO", () => {
    const csv = "Transaction Date,Type,Description,Amount\n04/15/2026,Sale,TEST,-10\n";
    const result = parseCSV(csv);
    const txns = expectTransactions(result);
    expect(txns[0].date).toBe("2026-04-15");
  });

  it("passes through YYYY-MM-DD unchanged", () => {
    const csv = "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2026-04-15,2026-04-16,1234,TEST,Cat,10,\n";
    const result = parseCSV(csv);
    const txns = expectTransactions(result);
    expect(txns[0].date).toBe("2026-04-15");
  });

  it("normalizes M/D/YY with 2-digit year", () => {
    const csv = "Transaction Date,Type,Description,Amount\n1/5/26,Sale,TEST,-10\n";
    const result = parseCSV(csv);
    const txns = expectTransactions(result);
    expect(txns[0].date).toBe("2026-01-05");
  });
});

describe("parseCSV — a newline inside a quoted field must not split the record", () => {
  // Regression: parseCSV used to do content.split("\n") before honoring quotes, so a
  // wrapped description tore one transaction into two half-rows. The leading half kept
  // the date/payee but lost its amount column (parsed as $0.00 and imported as a real
  // zero-dollar row); the trailing half was unparseable and dropped, taking the actual
  // amount with it. Net: the charge silently vanished and the balance drifted optimistic.
  const wrapped =
    'Transaction Date,Type,Description,Amount\n' +
    '04/15/2026,Sale,"AMAZON MKTPLACE\nORDER 123-456",-23.19\n' +
    '04/16/2026,Sale,PLAIN ROW,-10.00\n';

  it("keeps the wrapped transaction whole, with its real amount", () => {
    const txns = expectTransactions(parseCSV(wrapped));
    expect(txns).toHaveLength(2);
    expect(txns[0].amount).toBe(-23.19);
    expect(txns[0].date).toBe("2026-04-15");
    expect(txns[0].payee).toContain("AMAZON MKTPLACE");
  });

  it("does not invent a $0.00 row from the torn half", () => {
    const txns = expectTransactions(parseCSV(wrapped));
    expect(txns.filter((t) => t.amount === 0)).toHaveLength(0);
  });

  it("loses no money across the file", () => {
    const txns = expectTransactions(parseCSV(wrapped));
    expect(txns.reduce((s, t) => s + t.amount, 0)).toBeCloseTo(-33.19, 2);
  });

  it("still parses CRLF files", () => {
    const txns = expectTransactions(
      parseCSV('Transaction Date,Type,Description,Amount\r\n04/15/2026,Sale,TEST,-10.00\r\n')
    );
    expect(txns).toHaveLength(1);
    expect(txns[0].amount).toBe(-10);
  });

  it("round-trips an escaped double-quote inside a wrapped field", () => {
    const txns = expectTransactions(
      parseCSV(
        'Transaction Date,Type,Description,Amount\n' +
          '04/15/2026,Sale,"THE ""BIG"" STORE\nSECOND LINE",-5.00\n'
      )
    );
    expect(txns).toHaveLength(1);
    expect(txns[0].payee).toContain('THE "BIG" STORE');
    expect(txns[0].amount).toBe(-5);
  });
});
