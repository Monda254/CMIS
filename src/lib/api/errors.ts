/**
 * Normalized API Error Handling for Frontend Components (Sections 8 & 25).
 */

import type { ApiErrorPayload } from "./types";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
    requestId: string | null = null,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isValidation(): boolean {
    return this.status === 422 || this.status === 400;
  }
}

export function normalizeApiError(status: number, body: ApiErrorPayload | null): ApiClientError {
  const code = body?.error?.code ?? (status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : "API_ERROR");
  const message =
    body?.error?.message ??
    body?.message ??
    (status === 401
      ? "Your session has expired. Please sign in again."
      : status === 403
        ? "You do not have permission to perform this action."
        : `Request failed (${status})`);
  const details = body?.error?.details ?? {};
  const requestId = body?.request_id ?? null;
  return new ApiClientError(status, code, message, details, requestId);
}
