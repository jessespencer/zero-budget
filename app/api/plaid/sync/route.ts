import { NextResponse } from "next/server";

// Placeholder for Plaid transaction sync webhook
export async function POST() {
  return NextResponse.json(
    { error: "Plaid integration not yet implemented" },
    { status: 501 }
  );
}
