import { NextResponse } from "next/server";
import { HttpError } from "./auth";

/**
 * Standardized Next.js API Error Handler (MP-17 SEC-04 Hardened).
 * Never exposes internal stack traces, SQL queries, or raw database error strings on 500 responses.
 */
export function handleApiError(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json(
      {
        error: {
          code: err.status === 401 ? "UNAUTHENTICATED" : err.status === 403 ? "FORBIDDEN" : err.status === 429 ? "RATE_LIMIT_EXCEEDED" : "HTTP_ERROR",
          message: err.message,
        },
        message: err.message,
      },
      { status: err.status },
    );
  }
  console.error("[Internal API Error]", err);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected internal server error occurred",
      },
      message: "An unexpected internal server error occurred",
    },
    { status: 500 },
  );
}
