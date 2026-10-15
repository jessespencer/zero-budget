import { NextResponse } from "next/server";

// No auth middleware needed for single-user app
export function middleware() {
  return NextResponse.next();
}
