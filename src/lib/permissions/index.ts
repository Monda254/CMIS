/**
 * Permission-Aware UI Helpers (Sections 6.2, 7 & 28).
 * Mirrors the backend RBAC capability matrix from MP-15 (`fastapi_service/core/permissions.py`).
 * Note: Frontend permission checks control UI visibility only; the FastAPI backend remains authoritative.
 */

export type AppRole = "admin" | "cashier" | "accountant" | "auditor" | string;

export interface PermissionUser {
  id?: string;
  role?: AppRole | null;
  active?: boolean;
  permissions?: string[];
}

const ROLE_CAPABILITIES: Record<string, Set<string>> = {
  admin: new Set(["*"]),
  cashier: new Set([
    "clients:read",
    "clients:write",
    "quotations:read",
    "quotations:write",
    "quotations:issue",
    "invoices:read",
    "invoices:write",
    "invoices:issue",
    "payments:read",
    "payments:write",
    "payments:confirm",
    "payments:allocate",
    "receipts:read",
    "receipts:write",
    "receipts:finalize",
    "receipts:print",
    "communications:read",
    "communications:send",
    "taxes:read",
    "company:read",
    "dashboard:read",
  ]),
  accountant: new Set([
    "clients:read",
    "clients:write",
    "quotations:read",
    "quotations:write",
    "quotations:issue",
    "invoices:read",
    "invoices:write",
    "invoices:issue",
    "payments:read",
    "payments:write",
    "payments:confirm",
    "payments:allocate",
    "payments:refund",
    "receipts:read",
    "receipts:write",
    "receipts:finalize",
    "receipts:print",
    "reconciliation:read",
    "reconciliation:write",
    "reconciliation:confirm",
    "reports:read",
    "taxes:read",
    "company:read",
    "dashboard:read",
  ]),
  auditor: new Set([
    "clients:read",
    "quotations:read",
    "invoices:read",
    "payments:read",
    "receipts:read",
    "reconciliation:read",
    "reports:read",
    "audit:read",
    "taxes:read",
    "company:read",
    "dashboard:read",
  ]),
};

export function hasPermission(user: PermissionUser | null | undefined, permission: string): boolean {
  if (!user || user.active === false) return false;
  if (user.role === "admin") return true;
  if (user.permissions && (user.permissions.includes("*") || user.permissions.includes(permission))) {
    return true;
  }
  const roleSet = user.role ? ROLE_CAPABILITIES[user.role] : undefined;
  if (!roleSet) return false;
  return roleSet.has("*") || roleSet.has(permission);
}

export function isAdminUser(user: PermissionUser | null | undefined): boolean {
  return Boolean(user && user.active !== false && user.role === "admin");
}
