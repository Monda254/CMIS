"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiFetch } from "./api-client";

export type Me = {
  id: string;
  email: string | null;
  fullName: string;
  active: boolean;
  role: "admin" | "cashier" | null;
};

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<Me | null> => {
      const data = await apiFetch<{ user: Me | null }>("/api/auth/me");
      return data.user;
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  const router = useRouter();
  return async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    await qc.cancelQueries();
    qc.clear();
    router.replace("/auth");
    router.refresh();
  };
}
