# Open Decisions Register

Tracked per the master development brief, section 12. Each item records the current status, why it matters, and the temporary assumption the app currently uses. None of these assumptions is permanent — confirm each with the business owner and update this file.

| # | Question | Status | Why it matters | Current temporary assumption |
|---|----------|--------|----------------|------------------------------|
| 1 | Client's business type and operating model | Open | Shapes receipt wording, reports and fields | Generic services/goods receipts; no industry-specific fields |
| 2 | One company or multiple | Open | Data model & branding | One company (single company settings record) |
| 3 | Multiple branches needed | Open | Numbering, reporting | Not supported |
| 4 | Receipt only after full payment, or partial payment | Open | Semantics of totals and reports | A receipt records value issued; no payment tracking |
| 5 | Invoices, refunds, credit notes, balances | Open | Scope | Not implemented |
| 6 | Which payment methods to record | Open | Receipt content, reports | Not recorded |
| 7 | VAT / other tax calculations | Open | Totals, legal compliance | No tax fields; totals are quantity × unit price only |
| 8 | Currency / currencies | Open | Display, totals | KES default, configurable in Settings (3-letter code) |
| 9 | Receipt numbering format and reset policy | Open | Legal numbering | `PREFIX-YYYY-NNNNNN`, resets yearly, prefix configurable; gaps can occur when a draft fails to finalize — numbers come from a dedicated sequence table, never by counting |
| 10 | Approved correction and cancellation procedure | Open | Audit integrity | Admin-only cancellation with a mandatory reason; original record preserved, never edited or deleted |
| 11 | What receipt info may show publicly on verification | Open | Privacy | Minimal data: number, company, masked customer name, date, total, status. No phone, address or notes |
| 12 | Public verification without login | Open | Access & abuse | Yes, public; rate-limited (30 attempts/hour per visitor, 10 per code per 10 minutes) |
| 13 | Historical data import | Open | Migration effort | Not implemented |
| 14 | Hosting environment and final domain | Open | QR codes embed the domain | QR codes use the served origin, so they adapt to the final domain; already-issued receipts keep their original snapshot but QR URLs regenerate at print time |
| 15 | Offline operation required | Open | Architecture | Online-only |
| 16 | Backup frequency and recovery expectations | Open | Operations | Platform-managed backups |
| 17 | Retention rules and data-protection obligations | Open | Data lifecycle | No automatic deletion; cancelled receipts retained |
| 18 | Receipt design, logo, stamp, signature assets | Open | Print fidelity | Uploads provided in Settings; printed sheet is a clean A4 layout |
| 19 | Notifications, email or SMS verification | Open | Scope | None |
| 20 | Budget, deadline, maintenance expectations | Open | Planning | N/A |

## Known implementation notes

- "Receipt value" everywhere means the sum of issued receipt totals; it is never labelled cash collected.
- Excel exports are true .xlsx files; all user-typed text is neutralised against spreadsheet formula injection, and exports are capped at 10,000 receipts per range.
- PDF download uses the browser's print dialog (choose "Save as PDF"), which keeps the printed page, the PDF and the on-screen receipt identical.
- Verification attempts are logged server-side with only a hashed IP — nothing personal is stored.
