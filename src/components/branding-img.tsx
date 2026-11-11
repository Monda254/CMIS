"use client";

import { resolveBrandingUrl } from "@/lib/storage";

/** One branding image (logo, stamp or signature) resolved through the authenticated server branding route. */
export function BrandingImg({ path, alt, className }: { path: string | null; alt: string; className?: string }) {
  const src = resolveBrandingUrl(path);
  if (!src) return null;
  return <img src={src} alt={alt} className={className} />;
}
