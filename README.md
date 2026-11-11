# Ledgerly — Receipt & Client Management System

Issue numbered receipts, keep a clean client history, and let anyone confirm a receipt is genuine with a QR scan.

## Tech Stack

- **Frontend**: Next.js (App Router), TypeScript, Tailwind CSS, Radix UI (`shadcn/ui`), Recharts
- **Backend**:
  - **Next.js Server Routes & Services** (`src/app/api/**`, `src/lib/server/**`) for authentication, transactional mutations, and server-side PDF generation
  - **FastAPI Data Service** (`fastapi_service/main.py`) with `asyncpg` connection pooling for high-speed dashboard KPIs, receipt register queries, and date-range report aggregations (with automatic Drizzle ORM fallback)
- **Database**: Standalone PostgreSQL with **Drizzle ORM** (`drizzle/schema.ts`)
- **Authentication**: Secure server-managed sessions (`HttpOnly`, `SameSite=Lax` cookies backed by SHA-256 hashed tokens in PostgreSQL `sessions` and `scrypt` password hashing)
- **PDF**: Server-side A4 PDF generation (`/api/receipts/[id]/pdf`) with embedded vector QR codes and duplicate/cancelled banners, plus dedicated A4 browser print sheet (`/receipts/[id]/print`)
- **QR Codes**: `qrcode.react` on the client and pure TypeScript ISO/IEC 18004 QR matrix vector encoder (`src/lib/server/qr-matrix.ts`) on the server

## Local Development

1. Configure your `.env` file:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ledgerly"
FASTAPI_URL="http://127.0.0.1:8000"
FASTAPI_INTERNAL_SECRET="ledgerly-internal-dev-secret"
```

2. Initialize the PostgreSQL schema:

```sh
npm install
npm run db:push
# or apply drizzle/migrations/0000_migration.sql directly with psql
```

3. Start the Next.js application (and optionally the FastAPI high-speed data service):

```sh
# Terminal 1 — Next.js App Router (http://localhost:3000)
npm run dev

# Terminal 2 (optional) — FastAPI Data Service (http://127.0.0.1:8000)
pip install -r fastapi_service/requirements.txt
npm run fastapi
```
