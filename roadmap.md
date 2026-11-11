# Roadmap — Receipt & Client Management System (Ledgerly)

Backend complete (auth, roles, clients, receipts engine, audit, settings, storage, verify RPC).

- [x] Auth (email/Google/reset), first-user-admin, activation flow
- [x] Public verify page (basic), basic dashboard
- [x] DB: receipts/items/sequences/settings/clients/audit/branding bucket
- [x] Rate-limited public verification (attempts table + verify_receipt_limited + /api/public/verify)
- [x] Responsive app navigation (role-aware workspace menu, public links on landing/auth/verification pages)
- [x] Dashboard: recent receipts/activity, quick actions, admin chart
- [x] Clients page (list/search/add/edit)
- [x] Receipt register list (filters/search)
- [x] New/edit receipt form (items, live totals, save draft, finalize)
- [x] Receipt detail (finalize/cancel/delete/print/edit)
- [x] A4 print page w/ QR, record_print, duplicate indicator
- [x] QR deep link /verify/$token (public auto-verify)
- [x] Company settings page (details + logo/stamp/signature uploads)
- [x] User management (admin)
- [x] Activity log viewer (admin)
- [x] Reports + CSV/Excel export (formula-injection safe) + PDF via print
- [x] docs/open-decisions.md (20 tracked questions)

## Verification done (browser E2E, 2026-11-05)
- Route-split layouts verified: /receipts/new, /receipts/$id, /receipts/$id/edit, /receipts/$id/print, /verify/$token each render their own page.
- Receipt issued end-to-end: RCP-2026-000001, total KES 32,501.00 correct, code shown, QR deep link verified public (masked customer).
- record_print incremented (print_count 1 in DB).
- Draft saved, edited, re-saved: authoritative totals in DB (3600.00).
- Rate limit confirmed: verify endpoint returns rate_limited after the hourly/IP budget.
- Settings/users/reports/activity/clients/dashboard pages all load signed-in, no page errors.

## Remaining (needs user decisions)
- The 20 open decisions in docs/open-decisions.md — most features have temporary assumptions.
- Test receipts RCP-2026-000001 + two drafts exist in the backend from E2E testing.

## Requirements audit notes
- Implemented: company identity and branding uploads; receipt drafts and issue flow, numbering/code/time, server-calculated totals, saved client records, client search/edit/history links, A4 print layout, QR verification, dashboard counts and recent records, admin reports, Excel/CSV export, role-aware user management, password reset, and audit activity.
- Implemented with limits: receipt register search covers receipt number and customer name (not verification code); date ranges are available in Reports, not the register. Client transaction history is a receipt-list link, while per-client totals are shown in Reports rather than the client list. Cashier access to monetary reports is not assigned/configurable; receipt values are admin-only.
- Not implemented: a user-facing receipt-verification attempts report, PDF file generation outside the browser print dialog, in-app backup/restore controls, and a separate duplicate-receipt record flow.
- PDF files are produced through the browser print dialog; there is no separate PDF export service.
- Dashboard/report totals are issued receipt value, not confirmed revenue or payments collected; payment/tax features remain undecided.
- Duplicate print copies are marked; creating a separate duplicate receipt record is not supported.
- Backups are platform-managed; the app does not provide backup/restore controls.
- Public verification attempts are rate-limit records, not a user-facing verification report.
- Update note: receipt entry creates a client record when a new customer is entered; the client can then be reused in future receipts.
