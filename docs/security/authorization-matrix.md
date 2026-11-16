# IBMS Role & Permission Authorization Matrix (`MP-17`)

## 1. RBAC Architecture

IBMS enforces backend authorization through two complementary mechanisms in `fastapi_service/core/permissions.py`:
1. **Normalized Database RBAC**: Tables `public.roles`, `public.permissions`, `public.role_permissions`, and `public.user_roles`.
2. **Role-to-Permission Mapping (`ROLE_DEFAULT_PERMISSIONS`)**: Maps each user's primary role (`admin`, `manager`, `finance`, `cashier`, `auditor`) to explicit module permissions (`<module>:<action>`).

Frontend navigation and action buttons (`src/lib/auth/permissions.ts`) reflect this matrix for UX clarity, while **every API endpoint enforces permissions independently at the backend**.

---

## 2. Module Permission Matrix

| Module / Capability | Permission Code | `admin` | `manager` | `finance` | `cashier` | `auditor` |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Users & Roles**: List / Create / Update / Deactivate | `users:read`, `users:write` (`require_roles("admin")`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Company Settings & Branding**: View | `company:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Company Settings, Taxes & Templates**: Modify | `company:write`, `taxes:write` | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Clients (CRM)**: View / Search / Statement | `clients:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Clients (CRM)**: Create / Edit Contacts & Addresses | `clients:write` | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Quotations**: View / Export | `quotations:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Quotations**: Draft / Issue / Approve / Convert | `quotations:write` | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Invoices**: View / Ledger | `invoices:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Invoices**: Create Draft / Issue | `invoices:write`, `invoices:issue` | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Invoices**: Cancel / Void Issued Invoice | `invoices:cancel` | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Payments**: View / Allocation History | `payments:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Payments**: Record / Confirm / Allocate | `payments:write`, `payments:confirm`, `payments:allocate` | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Payments**: Refund / Reverse Confirmed Payment | `payments:refund`, `payments:reverse` | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Receipts**: View / Generate / Print / PDF | `receipts:read`, `receipts:write` | ✅ | ✅ | ✅ | ✅ | ✅ (Read) |
| **Receipts**: Cancel / Void Finalized Receipt | `receipts:cancel` | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Dashboard & Reports**: View / Export CSV & XLSX | `dashboard:read`, `reports:read`, `reports:export` | ✅ | ✅ | ✅ | ✅ (Dash) | ✅ |
| **Communications**: View / Send Document Email or SMS | `communications:read`, `communications:write` | ✅ | ✅ | ✅ | ✅ | ✅ (Read) |
| **Reconciliation**: View / Import / Match / Close | `reconciliation:read`, `reconciliation:write` | ✅ | ✅ (Read) | ✅ | ❌ | ✅ (Read) |
| **Audit Logs**: View Forensic Trail | `audit:read` | ✅ | ❌ | ❌ | ❌ | ✅ |

---

## 3. Object-Level & Cross-Entity Integrity Controls

- **Cross-Client Allocation Block**: `allocate_payment_to_invoices()` verifies `invoice.client_id == payment.client_id` while holding `FOR UPDATE` locks; mismatches fail with `409 CLIENT_MISMATCH`.
- **Self-Deactivation Block**: Administrators are blocked from deactivating their own active account (`409 CANNOT_DEACTIVATE_SELF`) or demoting the last active administrator.
- **Immutable Snapshot Isolation**: Issued receipts and invoices read company details from their stored `company_snapshot` rather than mutable live settings.
