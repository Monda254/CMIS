# MP-14 · Deliverable 3: Financial Data Model & Ledger Architecture

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-14

---

## 1. Fundamental Separation of Financial Entities

To prevent double-counting, silent balance manipulation, or ambiguous revenue metrics, the IBMS database enforces a strict four-layer separation of financial concepts:

| Financial Concept | Canonical Table(s) | What It Represents | Revenue / Ledger Impact |
|---|---|---|---|
| **1. Amount Invoiced** | `invoices`, `invoice_items` | The contractual billing obligation issued to a client. | Increases **Accounts Receivable (Billed)** once `status IN ('issued', 'partially_paid', 'paid', 'overdue')`. Draft/voided invoices are excluded. |
| **2. Amount Paid** | `payments` | Actual money received from the client via Cash, M-Pesa, Bank Transfer, Card, or Cheque. | Increases **Gross Cash Collections** when `status IN ('confirmed', 'partially_refunded', 'refunded')`. |
| **3. Amount Allocated** | `payment_allocations` | Explicit application of a confirmed payment toward settling a specific invoice. | Reduces the target invoice's `balance_due` and reduces the payment's `unallocated_amount`. |
| **4. Amount Receipted** | `receipts`, `payment_receipt_allocations` | Cryptographically verifiable proof of payment issued to the client. | Acknowledges money received (`payment_receipt_allocations.amount_acknowledged`). **Never** creates a second payment or double-counts revenue. |
| **5. Refunds & Reversals** | `payment_refunds` | Return or reversal of previously collected funds. | Preserves the original `payments` row; increases `payments.amount_refunded` and reduces **Net Collections**. |

---

## 2. Worked End-to-End Financial Lifecycle Example (Section 6.1)

**Scenario:**
- Invoice total = **KES 100,000.00** (`INV-2026-000101`)
- First payment = **KES 40,000.00** (`PAY-2026-000201`) → Allocated to `INV-2026-000101` → Acknowledged by `RCP-2026-000301` (`KES 40,000.00`)
- Second payment = **KES 60,000.00** (`PAY-2026-000202`) → Allocated to `INV-2026-000101` → Acknowledged by `RCP-2026-000302` (`KES 60,000.00`)

### State Transitions Across Tables

#### Step A — Invoice Issued (`KES 100,000.00`)
| Table | Key Identifier | `total` / `amount` | `amount_allocated` | `balance_due` | `status` |
|---|---|---:|---:|---:|---|
| `invoices` | `INV-2026-000101` | `100000.00` | `0.00` | `100000.00` | `issued` |

#### Step B — First Payment (`KES 40,000.00`), Allocation 1, and Receipt 1
| Table | Key Identifier | `total` / `amount` | `amount_allocated` / `acknowledged` | `balance_due` / `unallocated` | `status` |
|---|---|---:|---:|---:|---|
| `payments` | `PAY-2026-000201` | `40000.00` | `40000.00` (`receipted`: `40000.00`) | `0.00` | `confirmed` |
| `payment_allocations` | `ALLOC-1` (`PAY-1 → INV-1`) | `40000.00` | `40000.00` | — | `active` |
| `invoices` | `INV-2026-000101` | `100000.00` | `40000.00` | **`60000.00`** | `partially_paid` |
| `receipts` | `RCP-2026-000301` | `40000.00` | `amount_paid = 40000.00` | `0.00` | `finalized` |
| `payment_receipt_allocations` | `PRA-1` (`PAY-1 → RCP-1`) | `40000.00` | `40000.00` | — | `active` |

#### Step C — Second Payment (`KES 60,000.00`), Allocation 2, and Receipt 2
| Table | Key Identifier | `total` / `amount` | `amount_allocated` / `acknowledged` | `balance_due` / `unallocated` | `status` |
|---|---|---:|---:|---:|---|
| `payments` | `PAY-2026-000202` | `60000.00` | `60000.00` (`receipted`: `60000.00`) | `0.00` | `confirmed` |
| `payment_allocations` | `ALLOC-2` (`PAY-2 → INV-1`) | `60000.00` | `60000.00` | — | `active` |
| `invoices` | `INV-2026-000101` | `100000.00` | `100000.00` | **`0.00`** | `paid` |
| `receipts` | `RCP-2026-000302` | `60000.00` | `amount_paid = 60000.00` | `0.00` | `finalized` |
| `payment_receipt_allocations` | `PRA-2` (`PAY-2 → RCP-2`) | `60000.00` | `60000.00` | — | `active` |

---

## 3. Critical Payment-to-Receipt Relationship & Anti-Double-Receipting Rules

### Architectural Problem
A business may:
1. Issue **one receipt for one payment** (1:1).
2. Split **one large corporate payment across multiple receipts** (1:N — e.g., departmental receipts).
3. Acknowledge **multiple partial payments in a single consolidated receipt** (N:1).
4. Issue a **direct walk-in/POS receipt** immediately alongside a direct payment without a prior invoice.

### Canonical Solution: `payment_receipt_allocations` + Database Integrity Constraints
We model the relationship with:
1. Optional convenience foreign key `receipts.primary_payment_id -> payments(id)` for simple 1:1 lookups.
2. Authoritative junction table **`payment_receipt_allocations`**:
   - Columns: `id (UUID PK)`, `payment_id (UUID FK -> payments.id)`, `receipt_id (UUID FK -> receipts.id)`, `amount_acknowledged NUMERIC(14,2) NOT NULL CHECK (amount_acknowledged > 0)`, `status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled'))`.
   - Unique index `uq_payment_receipt_active` on `(payment_id, receipt_id) WHERE status = 'active'`.
3. **Database-Level Anti-Over-Receipting Protection:**
   - On `payments`, `CHECK (amount_receipted >= 0 AND amount_receipted <= (amount - amount_refunded))` guarantees that the cumulative amount acknowledged across all active finalized receipts for a payment **can never exceed** the net confirmed payment amount (`amount - amount_refunded`).
   - A PostgreSQL trigger (`trg_enforce_payment_receipt_allocation`) locks the parent `payments` row (`SELECT ... FOR UPDATE`), sums all active `payment_receipt_allocations`, rejects any insert/update that would exceed `payments.amount - payments.amount_refunded` or attach to an unconfirmed payment, and updates `payments.amount_receipted` atomically.

---

## 4. Authoritative Client Ledger Derivation (`Section 6.2`)

The database **never** uses a manually editable `client_balance` column. Instead, the client ledger is derived deterministically from authoritative financial records via the SQL view `public.v_client_ledger_summary` (and corresponding SQLAlchemy query helpers):

- **Total Invoiced (`total_invoiced`):**
  $$\sum \text{invoices.total} \quad \text{WHERE status IN ('issued', 'partially\_paid', 'paid', 'overdue')}$$
- **Gross Confirmed Payments (`total_confirmed_payments`):**
  $$\sum \text{payments.amount} \quad \text{WHERE status IN ('confirmed', 'partially\_refunded', 'refunded')}$$
- **Total Refunds (`total_refunds`):**
  $$\sum \text{payment\_refunds.amount} \quad \text{WHERE status = 'completed'}$$
- **Net Collections (`net_collections`):**
  $$\text{total\_confirmed\_payments} - \text{total\_refunds}$$
- **Total Allocated to Invoices (`total_allocated`):**
  $$\sum \text{payment\_allocations.amount} \quad \text{WHERE status = 'active'}$$
- **Unallocated Client Credit (`unallocated_credit`):**
  $$\text{net\_collections} - \text{total\_allocated}$$
- **Outstanding Invoice Balance (`outstanding_invoice_balance`):**
  $$\text{total\_invoiced} - \text{total\_allocated}$$
- **Total Receipted (`total_receipted`):**
  $$\sum \text{receipts.amount\_paid} \quad \text{WHERE status = 'finalized'}$$

---

## 5. Refunds, Reversals & Receipt Cancellation Workflow (`Section 6.3`)

1. **Original Payment Preservation:** When a payment is refunded or reversed, the row in `payments` is **never deleted** and its original `amount` is **never overwritten**.
2. **Traceable Refund Event:** A row is inserted into `payment_refunds` (`amount`, `reason`, `processed_by`, `refunded_at`).
3. **Database Trigger / Service Update:**
   - `payments.amount_refunded` is incremented by the completed refund amount.
   - `payments.status` transitions to `'partially_refunded'` (if `amount_refunded < amount`) or `'refunded'` (if `amount_refunded = amount`).
   - If the refund reduces net available funds below `payments.amount_allocated`, the corresponding `payment_allocations` must be reversed (`status = 'reversed'`) within the same transaction, restoring the invoice's `balance_due`.
   - Any finalized `receipts` covering the refunded portion are either marked with `payment_status = 'refunded'` or cancelled via `cancelReceipt` (`status = 'cancelled'`, `cancel_reason`), while preserving the receipt record and its `verify_attempts` audit history.
