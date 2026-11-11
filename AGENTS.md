# Project decisions

- **Stack**: Next.js App Router (TypeScript, Tailwind CSS) + Drizzle ORM on standalone PostgreSQL + companion FastAPI service (`fastapi_service/main.py`) for high-speed read/report queries.
- **Authentication**: Server-managed sessions stored in PostgreSQL (`users` and `sessions` tables) using `scrypt` password hashing and `HttpOnly`, `SameSite=Lax` session cookies (`ledgerly_session`).
- **Public Verification**: Goes through `POST /api/public/verify`, which hashes the caller IP (`SHA-256`) and enforces DB-backed rate limits (`verify_attempts`: 30/hour per visitor, 10/10min per identifier).
- **Authoritative Money Math**: All receipt line totals and receipt totals are calculated transactionally on the server in `src/lib/server/services.ts` (`saveReceiptDraft`, `finalizeReceipt`); the browser only displays previews.
- **Immutability**: Issued receipts are immutable; correction is admin-only cancellation with a mandatory reason (`cancelReceipt`). Company details on issued receipts come from the stored `company_snapshot`, never live settings.
- **PDF & Printing**: Server-side A4 PDF generation lives at `GET /api/receipts/[id]/pdf` (`src/lib/server/pdf.ts`) with embedded vector QR codes, and browser printing lives at `/receipts/[id]/print`. Both increment `print_count` via `recordPrint` and mark reprints (`copy > 1`) with a visible duplicate copy banner.
- **QR Codes**: Encode `${origin}/verify/<verification_code>`; the public deep-link route is `/verify/[token]`.
- **Reports**: Date-range report queries run via FastAPI (`/api/v1/reports`) with automatic fallback to Drizzle ORM (`/api/reports`), and CSV/Excel exports (`xlsx`) sanitize every user-typed cell against spreadsheet formula injection.
