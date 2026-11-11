import { NextResponse } from "next/server";
import { HttpError } from "./auth";

export function handleApiError(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ message: err.message }, { status: err.status });
  }
  if (err instanceof Error) {
    console.error("[API Error]", err);
    return NextResponse.json({ message: err.message || "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ message: "Internal server error" }, { status: 500 });
}
