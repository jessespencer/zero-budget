import { NextRequest, NextResponse } from "next/server";
import { parseCSV } from "@/lib/csv-parsers";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large (max 5 MB)" },
      { status: 413 }
    );
  }

  const content = await file.text();
  const result = parseCSV(content);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if ("needsMapping" in result) {
    return NextResponse.json({
      needsMapping: true,
      headers: result.headers,
      rows: result.rows,
    });
  }

  return NextResponse.json({
    bank: result.bank,
    transactions: result.transactions,
    count: result.transactions.length,
  });
}
