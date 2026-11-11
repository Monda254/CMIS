"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
  LayoutGrid,
  Lock,
  LogOut,
  Menu,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { useMe, useSignOut } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type QuickStats = {
  company_name?: string;
  currency?: string;
  issued?: number;
  drafts?: number;
  cancelled?: number;
};

type VerifyResponse = {
  result: "valid" | "cancelled" | "not_found" | "invalid" | "rate_limited";
  receipt_number?: string;
  code_hint?: string;
  customer?: string;
  issued_at?: string;
  total?: number;
  currency?: string;
  company?: string;
  cancelled_at?: string;
};

function getBreadcrumbLabel(pathname: string): string {
  if (pathname === "/dashboard") return "Overview";
  if (pathname === "/receipts/new") return "Create receipt";
  if (pathname.endsWith("/edit")) return "Edit receipt";
  if (pathname.endsWith("/print")) return "Print preview";
  if (pathname.startsWith("/receipts/")) return "Print preview";
  if (pathname === "/receipts") return "Receipts";
  if (pathname.startsWith("/clients/")) return "Client profile";
  if (pathname === "/clients") return "Clients";
  if (pathname === "/reports") return "Reports";
  if (pathname === "/settings") return "Company settings";
  if (pathname === "/users") return "Team & access";
  if (pathname === "/activity") return "Security & activity";
  if (pathname.startsWith("/verify")) return "Verification";
  return "Overview";
}

function getInitials(nameOrEmail: string): string {
  const cleaned = nameOrEmail.trim();
  if (!cleaned) return "WS";
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const signOut = useSignOut();
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = me.data?.role === "admin";

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const statsQuery = useQuery({
    queryKey: ["shell-quick-stats"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard", { credentials: "include" });
      if (!res.ok) return null;
      return (await res.json()) as QuickStats;
    },
    staleTime: 30_000,
  });

  const searchReceiptsQuery = useQuery({
    queryKey: ["global-search-receipts", searchOpen],
    enabled: searchOpen,
    queryFn: async () => {
      const res = await fetch("/api/receipts?limit=50", { credentials: "include" });
      if (!res.ok) return [];
      return (await res.json()) as Array<{
        id: string;
        receipt_number: string | null;
        verification_code?: string | null;
        customer_name: string;
        total: string | number;
        currency: string;
        status: string;
      }>;
    },
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const totalReceiptsCount =
    (statsQuery.data?.issued ?? 0) + (statsQuery.data?.drafts ?? 0) + (statsQuery.data?.cancelled ?? 0);
  const companyName = statsQuery.data?.company_name || "Northstar Studio";
  const breadcrumb = getBreadcrumbLabel(pathname);
  const userName = me.data?.fullName || me.data?.email || "Sarah Mitchell";
  const userRoleLabel = isAdmin ? "Administrator" : "Receptionist / Cashier";
  const initials = getInitials(userName);

  const manageNav = [
    {
      href: "/dashboard",
      label: "Overview",
      icon: LayoutGrid,
      active: pathname === "/dashboard",
    },
    {
      href: "/receipts",
      label: "Receipts",
      icon: FileText,
      badge: totalReceiptsCount > 0 ? totalReceiptsCount : undefined,
      active: pathname.startsWith("/receipts"),
    },
    {
      href: "/clients",
      label: "Clients",
      icon: Users,
      active: pathname.startsWith("/clients"),
    },
    {
      href: "/verify",
      label: "Verification",
      icon: ShieldCheck,
      active: pathname.startsWith("/verify"),
    },
    {
      href: "/reports",
      label: "Reports",
      icon: BarChart3,
      active: pathname.startsWith("/reports"),
    },
  ];

  const workspaceNav = [
    {
      href: "/settings",
      label: "Company settings",
      icon: SlidersHorizontal,
      active: pathname.startsWith("/settings"),
    },
    {
      href: "/users",
      label: "Team & access",
      icon: Users,
      active: pathname.startsWith("/users"),
    },
    {
      href: "/activity",
      label: "Security & activity",
      icon: Lock,
      active: pathname.startsWith("/activity"),
    },
  ];

  const runQuickVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = verifyInput.trim();
    if (!cleaned) return;
    setVerifyLoading(true);
    try {
      const res = await fetch("/api/public/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: cleaned }),
      });
      const data = (await res.json()) as VerifyResponse;
      setVerifyResult(data);
    } catch {
      setVerifyResult({ result: "invalid" });
    } finally {
      setVerifyLoading(false);
    }
  };

  const filteredSearchReceipts = (searchReceiptsQuery.data ?? [])
    .filter((r) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (r.receipt_number ?? "draft").toLowerCase().includes(q) ||
        (r.verification_code ?? "").toLowerCase().includes(q) ||
        r.customer_name.toLowerCase().includes(q)
      );
    })
    .slice(0, 6);

  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => {
    const Wrapper = mobile ? SheetClose : ({ children: c }: { children: React.ReactNode }) => <>{c}</>;
    return (
      <div className="flex h-full flex-col bg-white text-[#20232D]">
        {/* Brand Wordmark */}
        <div className="px-6 pt-7 pb-5">
          <Link href="/dashboard" className="inline-flex items-center gap-2.5">
            <span className="font-display text-[26px] font-extrabold tracking-tight text-[#20232D]">
              folio
            </span>
          </Link>
        </div>

        {/* Workspace Switcher */}
        <div className="px-4 pb-5">
          <p className="px-2 pb-2 text-[10px] font-semibold tracking-[0.08em] text-[#7A7F8C] uppercase">
            Workspace
          </p>
          <div className="rounded-lg bg-[#F7F8FA] px-3.5 py-2.5 border border-[#E6E8EF]/60">
            <p className="truncate text-[13px] font-semibold text-[#20232D]">{companyName}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[#7A7F8C]">
              <span>Business workspace</span>
              <ChevronDown className="h-3 w-3 opacity-70" />
            </p>
          </div>
        </div>

        {/* Navigation Sections */}
        <div className="flex-1 space-y-6 overflow-y-auto px-3">
          <div>
            <p className="px-3 pb-2 text-[10px] font-semibold tracking-[0.08em] text-[#7A7F8C] uppercase">
              Manage
            </p>
            <nav aria-label="Manage navigation" className="space-y-0.5">
              {manageNav.map((item) => {
                const Icon = item.icon;
                return (
                  <Wrapper key={item.href} asChild={mobile ? true : undefined}>
                    <Link
                      href={item.href}
                      className={`group flex items-center justify-between rounded-[7px] px-3 py-2.5 text-[13.5px] transition-colors ${
                        item.active
                          ? "bg-[#EEECFC] font-semibold text-[#5848D6]"
                          : "font-medium text-[#4A4F5C] hover:bg-[#F7F8FA] hover:text-[#20232D]"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Icon
                          className={`h-4 w-4 ${
                            item.active ? "text-[#5848D6]" : "text-[#7A7F8C] group-hover:text-[#20232D]"
                          }`}
                        />
                        {item.label}
                      </span>
                      {item.badge !== undefined && (
                        <span
                          className={`text-[11px] font-medium tabular ${
                            item.active ? "text-[#5848D6]" : "text-[#7A7F8C]"
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </Wrapper>
                );
              })}
            </nav>
          </div>

          {isAdmin && (
            <div>
              <p className="px-3 pb-2 text-[10px] font-semibold tracking-[0.08em] text-[#7A7F8C] uppercase">
                Workspace
              </p>
              <nav aria-label="Workspace settings navigation" className="space-y-0.5">
                {workspaceNav.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Wrapper key={item.href} asChild={mobile ? true : undefined}>
                      <Link
                        href={item.href}
                        className={`group flex items-center gap-3 rounded-[7px] px-3 py-2.5 text-[13.5px] transition-colors ${
                          item.active
                            ? "bg-[#EEECFC] font-semibold text-[#5848D6]"
                            : "font-medium text-[#4A4F5C] hover:bg-[#F7F8FA] hover:text-[#20232D]"
                        }`}
                      >
                        <Icon
                          className={`h-4 w-4 ${
                            item.active ? "text-[#5848D6]" : "text-[#7A7F8C] group-hover:text-[#20232D]"
                          }`}
                        />
                        {item.label}
                      </Link>
                    </Wrapper>
                  );
                })}
              </nav>
            </div>
          )}
        </div>

        {/* Bottom Trust Card */}
        <div className="px-3 pt-4 pb-3">
          <div className="rounded-xl bg-[#EEECFC]/85 p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/80 text-[#5848D6] shadow-2xs">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <button
                type="button"
                onClick={() => {
                  setVerifyResult(null);
                  setVerifyOpen(true);
                }}
                className="text-[11px] font-semibold text-[#5848D6] hover:underline"
              >
                Quick check ↗
              </button>
            </div>
            <p className="mt-2.5 text-[12.5px] font-bold text-[#20232D]">Built on trust.</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#646977]">
              Every receipt, verifiable.
              <br />
              Every transaction, protected.
            </p>
          </div>
        </div>

        {/* User Footer */}
        <div className="border-t border-[#E6E8EF] px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-[#20232D]">{userName}</p>
              <p className="truncate text-[11px] text-[#7A7F8C]">{userRoleLabel}</p>
            </div>
            <button
              type="button"
              onClick={signOut}
              title="Sign out"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#7A7F8C] transition-colors hover:bg-[#F7F8FA] hover:text-[#20232D]"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-dvh bg-[#F7F8FA] text-[#20232D]">
      {/* Fixed Left Sidebar (Desktop) */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[224px] border-r border-[#E6E8EF] bg-white lg:block">
        <SidebarContent />
      </aside>

      {/* Main Content Column */}
      <div className="lg:pl-[224px]">
        {/* Top Command Header */}
        <header className="no-print sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#E6E8EF] bg-white/95 px-4 backdrop-blur-xs sm:px-8">
          <div className="flex items-center gap-3">
            <div className="lg:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open navigation menu"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6E8EF] bg-white text-[#20232D]"
                  >
                    <Menu className="h-4 w-4" />
                  </button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[240px] p-0">
                  <SheetTitle className="sr-only">Workspace Navigation</SheetTitle>
                  <SidebarContent mobile />
                </SheetContent>
              </Sheet>
            </div>

            <div className="flex items-center gap-2 text-[13px]">
              <Link href="/dashboard" className="text-[#7A7F8C] transition-colors hover:text-[#20232D]">
                Workspace
              </Link>
              <span className="text-[#C4C8D4]">/</span>
              <span className="font-medium text-[#20232D]">{breadcrumb}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-5">
            {/* Search Your Workspace [⌘K] */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-9 w-44 items-center justify-between rounded-lg bg-[#F3F4F8] px-3 text-[12.5px] text-[#7A7F8C] transition-colors hover:bg-[#EAECEF] sm:w-64"
            >
              <span className="flex items-center gap-2 truncate">
                <Search className="h-3.5 w-3.5 shrink-0 text-[#7A7F8C]" />
                <span className="truncate">Search your workspace</span>
              </span>
              <kbd className="hidden rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#7A7F8C] shadow-2xs sm:inline-block">
                ⌘K
              </kbd>
            </button>

            <button
              type="button"
              onClick={() => {
                setVerifyResult(null);
                setVerifyOpen(true);
              }}
              className="hidden text-[12.5px] font-medium text-[#7A7F8C] transition-colors hover:text-[#20232D] md:inline-block"
            >
              Help center
            </button>

            {/* User Initials Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((prev) => !prev)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-[#20232D] transition-colors hover:bg-[#F3F4F8]"
              >
                <span>{initials}</span>
                <ChevronDown className="h-3.5 w-3.5 text-[#7A7F8C]" />
              </button>

              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-[#E6E8EF] bg-white p-1.5 shadow-lg">
                    <div className="border-b border-[#E6E8EF] px-3 py-2">
                      <p className="truncate text-[13px] font-semibold text-[#20232D]">{userName}</p>
                      <p className="truncate text-[11px] text-[#7A7F8C]">{me.data?.email}</p>
                    </div>
                    <div className="py-1">
                      <Link
                        href="/receipts/new"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-[#20232D] hover:bg-[#F7F8FA]"
                      >
                        <Plus className="h-3.5 w-3.5 text-[#5848D6]" />
                        Create receipt
                      </Link>
                      <Link
                        href="/verify"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-[#20232D] hover:bg-[#F7F8FA]"
                      >
                        <ShieldCheck className="h-3.5 w-3.5 text-[#16794F]" />
                        Public verification page
                      </Link>
                      {isAdmin && (
                        <Link
                          href="/settings"
                          onClick={() => setUserMenuOpen(false)}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-[#20232D] hover:bg-[#F7F8FA]"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5 text-[#7A7F8C]" />
                          Company settings
                        </Link>
                      )}
                    </div>
                    <div className="border-t border-[#E6E8EF] pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          signOut();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium text-[#B4343B] hover:bg-[#FCECEE]/60"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page Container */}
        <main className="mx-auto max-w-[1240px] px-4 py-7 sm:px-8">{children}</main>
      </div>

      {/* Global Search [⌘K] Modal */}
      {searchOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-start justify-center bg-[#20232D]/40 px-4 pt-20 backdrop-blur-[2px]">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#E6E8EF] bg-white shadow-2xl">
            <div className="flex items-center gap-3 border-b border-[#E6E8EF] px-4 py-3.5">
              <Search className="h-4 w-4 text-[#7A7F8C]" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search receipt no., verification code, client, or jump to page..."
                className="flex-1 bg-transparent text-[14px] text-[#20232D] outline-none placeholder:text-[#7A7F8C]"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="rounded-md p-1 text-[#7A7F8C] hover:bg-[#F3F4F8] hover:text-[#20232D]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto p-3 space-y-4">
              <div>
                <p className="px-2 pb-1.5 text-[10px] font-semibold tracking-wider text-[#7A7F8C] uppercase">
                  Quick Actions
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSearchOpen(false);
                      router.push("/receipts/new");
                    }}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-[#20232D] hover:bg-[#EEECFC] hover:text-[#5848D6]"
                  >
                    <Plus className="h-4 w-4 text-[#5848D6]" />
                    Create new receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchOpen(false);
                      setVerifyOpen(true);
                    }}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-[#20232D] hover:bg-[#EEECFC] hover:text-[#5848D6]"
                  >
                    <ShieldCheck className="h-4 w-4 text-[#16794F]" />
                    Verify receipt code
                  </button>
                </div>
              </div>

              <div>
                <p className="px-2 pb-1.5 text-[10px] font-semibold tracking-wider text-[#7A7F8C] uppercase">
                  Matching Receipts
                </p>
                {filteredSearchReceipts.length === 0 ? (
                  <p className="px-2 py-4 text-center text-[13px] text-[#7A7F8C]">
                    No matching receipts found.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {filteredSearchReceipts.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          setSearchOpen(false);
                          router.push(r.status === "draft" ? `/receipts/${r.id}/edit` : `/receipts/${r.id}`);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-[#F7F8FA]"
                      >
                        <div>
                          <span className="text-[13px] font-semibold text-[#5848D6]">
                            {r.receipt_number ?? "Draft receipt"}
                          </span>
                          <span className="mx-1.5 text-[#C4C8D4]">·</span>
                          <span className="text-[13px] font-medium text-[#20232D]">{r.customer_name}</span>
                          {r.verification_code && (
                            <span className="ml-2 font-mono text-[11px] text-[#7A7F8C]">
                              {r.verification_code}
                            </span>
                          )}
                        </div>
                        <span className="text-[12.5px] font-semibold tabular text-[#20232D]">
                          {formatMoney(r.total, r.currency)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Cryptographic Validator Modal (from Stitch Executive Design) */}
      {verifyOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/55 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#E6E8EF] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E6E8EF] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EEECFC] text-[#5848D6]">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-display text-[15px] font-bold text-[#20232D]">
                    Instant Receipt Verification
                  </h3>
                  <p className="text-[11.5px] text-[#7A7F8C]">
                    Validate any receipt number or verification code against the ledger
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVerifyOpen(false)}
                className="rounded-lg p-1.5 text-[#7A7F8C] hover:bg-[#F3F4F8] hover:text-[#20232D]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <form onSubmit={runQuickVerify} className="flex gap-2.5">
                <input
                  type="text"
                  value={verifyInput}
                  onChange={(e) => setVerifyInput(e.target.value.toUpperCase())}
                  placeholder="Enter receipt no. (RCP-2026-000125) or code..."
                  className="h-10 flex-1 rounded-lg border border-[#E6E8EF] bg-white px-3.5 font-mono text-[13px] text-[#20232D] outline-none focus:border-[#5848D6]"
                />
                <button
                  type="submit"
                  disabled={verifyLoading}
                  className="h-10 rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#4C3EC2] disabled:opacity-50"
                >
                  {verifyLoading ? "Checking..." : "Verify →"}
                </button>
              </form>

              {verifyResult && (
                <div
                  className={`rounded-xl border p-4 ${
                    verifyResult.result === "valid"
                      ? "border-[#C9EAD7] bg-[#E8F6EE]/70"
                      : verifyResult.result === "cancelled"
                        ? "border-[#F4DFB8] bg-[#FCF3E3]/70"
                        : "border-[#F6D2D6] bg-[#FCECEE]/70"
                  }`}
                >
                  {verifyResult.result === "valid" ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-[#16794F]">
                        <CheckCircle2 className="h-5 w-5" />
                        <p className="font-display text-[14px] font-bold">This receipt is authentic.</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 rounded-lg bg-white/90 p-3 text-[12px]">
                        <div>
                          <span className="text-[#7A7F8C]">Receipt no.:</span>{" "}
                          <span className="font-mono font-semibold text-[#20232D]">
                            {verifyResult.receipt_number}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#7A7F8C]">Client:</span>{" "}
                          <span className="font-semibold text-[#20232D]">{verifyResult.customer}</span>
                        </div>
                        <div>
                          <span className="text-[#7A7F8C]">Total:</span>{" "}
                          <span className="font-semibold tabular text-[#20232D]">
                            {formatMoney(verifyResult.total ?? 0, verifyResult.currency)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#7A7F8C]">Code:</span>{" "}
                          <span className="font-mono text-[#16794F]">{verifyResult.code_hint}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2.5 text-[#B4343B]">
                      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <p className="font-display text-[14px] font-bold">
                          {verifyResult.result === "cancelled"
                            ? "This receipt was cancelled."
                            : "We couldn't verify this receipt."}
                        </p>
                        <p className="mt-0.5 text-[12px] text-[#7A353B]">
                          {verifyResult.result === "cancelled"
                            ? `Receipt ${verifyResult.receipt_number} was voided by an administrator.`
                            : "No finalized receipt matches the number or verification code you entered."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-[#E6E8EF] pt-3 text-[12px] text-[#7A7F8C]">
                <span>Rate-limited public verification endpoint active</span>
                <Link
                  href="/verify"
                  onClick={() => setVerifyOpen(false)}
                  className="inline-flex items-center gap-1 font-semibold text-[#5848D6] hover:underline"
                >
                  Open public verification page <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
