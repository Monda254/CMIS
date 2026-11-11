"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { useMe } from "@/lib/auth";
import { errMsg, formatDate } from "@/lib/format";

type UserRow = {
  id: string;
  full_name: string;
  email: string;
  active: boolean;
  role: "admin" | "cashier";
  created_at: string;
};

const PERMISSIONS_MATRIX = [
  { label: "Create & print receipts", admin: "Full access", cashier: "Allowed" },
  { label: "Manage clients", admin: "Full access", cashier: "Allowed" },
  { label: "View reports", admin: "All reports", cashier: "Assigned reports" },
  { label: "Manage company settings", admin: "Full access", cashier: "—" },
  { label: "Manage users & roles", admin: "Full access", cashier: "—" },
  { label: "Security, backups & audit logs", admin: "Full access", cashier: "—" },
];

export default function UsersPage() {
  const me = useMe();
  const qc = useQueryClient();
  const inviteInputRef = useRef<HTMLInputElement>(null);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "cashier">("cashier");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<UserRow[]>("/api/users"),
  });

  const members = list.data ?? [];
  const activeCount = members.filter((u) => u.active).length;
  const pendingCount = members.filter((u) => !u.active).length;

  async function updateUser(u: UserRow, next: { role: "admin" | "cashier"; active: boolean }) {
    setError(null);
    setOpenMenuId(null);
    try {
      await apiFetch("/api/users", {
        method: "PATCH",
        body: JSON.stringify({
          userId: u.id,
          role: next.role,
          active: next.active,
        }),
      });
      toast.success("Team member access updated");
      await qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    try {
      await apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail.trim(),
          fullName: inviteName.trim(),
          role: inviteRole,
          password: invitePassword.trim() || undefined,
        }),
      });
      toast.success(`Added ${inviteEmail.trim()} to workspace`);
      setInviteEmail("");
      setInviteName("");
      setInvitePassword("");
      await qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header matching 10 · Team & access.svg */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">
            Team &amp; access
          </h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            The right access for the right people.
          </p>
        </div>

        <button
          type="button"
          onClick={() => inviteInputRef.current?.focus()}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white shadow-2xs transition-colors hover:bg-[#4C3EC2]"
        >
          <Plus className="h-4 w-4" />
          Invite team member
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-[#F6D2D6] bg-[#FCECEE] px-4 py-3 text-[13px] font-medium text-[#B4343B]">
          {error}
        </div>
      )}

      {/* Team Members Card */}
      <div className="rounded-xl border border-[#E6E8EF] bg-white">
        <div className="px-6 py-5">
          <h2 className="font-display text-[16px] font-bold text-[#20232D]">Team members</h2>
          <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
            {activeCount} active member{activeCount === 1 ? "" : "s"} · {pendingCount} pending
            invitation{pendingCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-y border-[#E6E8EF] bg-[#F7F8FA] text-[10.5px] font-semibold tracking-[0.06em] text-[#7A7F8C] uppercase">
                <th className="px-6 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last active</th>
                <th className="px-6 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
              {members.map((u) => {
                const isSelf = u.id === me.data?.id;
                const roleLabel = u.role === "admin" ? "Administrator" : "Receptionist / Cashier";
                return (
                  <tr key={u.id} className="transition-colors hover:bg-[#F7F8FA]/60">
                    <td className="px-6 py-4 font-semibold text-[#20232D]">
                      {u.full_name || u.email.split("@")[0]}
                      {isSelf && (
                        <span className="ml-2 rounded bg-[#EEECFC] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#5848D6]">
                          You
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-[#4A4F5C]">{u.email}</td>
                    <td className="px-4 py-4 text-[#20232D]">{roleLabel}</td>
                    <td className="px-4 py-4">
                      {u.active ? (
                        <span className="font-semibold text-[#16794F]">Active</span>
                      ) : (
                        <span className="font-semibold text-[#9A6316]">Invited</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-[#4A4F5C]">
                      {isSelf ? "Now" : u.active ? formatDate(u.created_at) : "Not joined yet"}
                    </td>
                    <td className="relative px-6 py-4 text-right">
                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => setOpenMenuId(openMenuId === u.id ? null : u.id)}
                        aria-label="Member actions"
                        className="rounded-md p-1.5 text-[#4A4F5C] hover:bg-[#F3F4F8] hover:text-[#20232D] disabled:opacity-30"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>

                      {openMenuId === u.id && (
                        <>
                          <div className="fixed inset-0 z-20" onClick={() => setOpenMenuId(null)} />
                          <div className="absolute right-6 z-30 mt-1 w-52 rounded-xl border border-[#E6E8EF] bg-white p-1.5 text-left shadow-lg">
                            <button
                              type="button"
                              onClick={() =>
                                updateUser(u, {
                                  role: u.role === "admin" ? "cashier" : "admin",
                                  active: u.active,
                                })
                              }
                              className="flex w-full items-center rounded-lg px-3 py-2 text-[12.5px] font-medium text-[#20232D] hover:bg-[#F7F8FA]"
                            >
                              Switch to {u.role === "admin" ? "Receptionist / Cashier" : "Administrator"}
                            </button>
                            <button
                              type="button"
                              onClick={() => updateUser(u, { role: u.role, active: !u.active })}
                              className={`flex w-full items-center rounded-lg px-3 py-2 text-[12.5px] font-medium hover:bg-[#F7F8FA] ${
                                u.active ? "text-[#B4343B]" : "text-[#16794F]"
                              }`}
                            >
                              {u.active ? "Suspend workspace access" : "Activate workspace access"}
                            </button>
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Row: Role Permissions Matrix (8 cols) + Grow Your Team (4 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Role Permissions Matrix */}
        <div className="rounded-xl border border-[#E6E8EF] bg-white lg:col-span-8">
          <div className="px-6 py-5">
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">Role permissions</h2>
            <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
              Keep sensitive settings in the right hands.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-y border-[#E6E8EF] bg-[#F7F8FA] text-[10.5px] font-semibold tracking-[0.06em] text-[#7A7F8C] uppercase">
                  <th className="px-6 py-3">Permission</th>
                  <th className="px-4 py-3">Administrator</th>
                  <th className="px-6 py-3">Receptionist / Cashier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
                {PERMISSIONS_MATRIX.map((row) => (
                  <tr key={row.label}>
                    <td className="px-6 py-4 font-medium text-[#20232D]">{row.label}</td>
                    <td className="px-4 py-4 font-semibold text-[#5848D6]">{row.admin}</td>
                    <td className="px-6 py-4 text-[#4A4F5C]">{row.cashier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Grow Your Team + Trail Callout */}
        <div className="space-y-5 lg:col-span-4">
          <div className="rounded-xl border border-[#E6E8EF] bg-white p-6">
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">Grow your team</h2>
            <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
              Send an invitation to your workspace.
            </p>

            <form onSubmit={handleInvite} className="mt-5 space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">
                  Email address
                </label>
                <input
                  ref={inviteInputRef}
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">
                  Full name (optional)
                </label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="James Wilson"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "cashier")}
                  aria-label="Member role"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
                >
                  <option value="cashier">Receptionist / Cashier</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">
                  Initial password (optional)
                </label>
                <input
                  type="password"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  placeholder="Defaults to WelcomeFolio2026!"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
                />
              </div>

              <button
                type="submit"
                disabled={inviting}
                className="flex h-10 w-full items-center justify-center rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white shadow-2xs transition-colors hover:bg-[#4C3EC2] disabled:opacity-50"
              >
                {inviting ? "Sending…" : "Send invitation →"}
              </button>
            </form>
          </div>

          <div className="rounded-xl bg-[#EEECFC] p-6">
            <h3 className="font-display text-[15px] font-bold text-[#5848D6]">
              Every change leaves a trail.
            </h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#5E6373]">
              Role updates and invitations are recorded in your workspace activity log.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
