"use client";

export function resolveBrandingUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) {
    return path;
  }
  return `/api/branding/${path.replace(/^\/+/, "")}`;
}
