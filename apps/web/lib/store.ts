"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import type { ProjectTypeT } from "@purpio/shared";
const idb = { getItem: (k: string) => idbGet(k).then((v) => v ?? null), setItem: (k: string, v: string) => idbSet(k, v), removeItem: (k: string) => idbDel(k) };
type Toast = { id: number; text: string };
type S = {
  user: any | null; setUser: (u: any) => void;
  draft: string; draftType: ProjectTypeT; model: string; setDraft: (d: Partial<{ draft: string; draftType: ProjectTypeT; model: string }>) => void;
  theme: "light" | "dark" | "system"; setTheme: (t: S["theme"]) => void;
  toasts: Toast[]; toast: (text: string) => void; dismiss: (id: number) => void;
  sheet: React.ReactNode | null; openSheet: (n: React.ReactNode) => void; closeSheet: () => void;
  credits: { total: number; held: number; available: number } | null; setCredits: (c: S["credits"]) => void;
};
export const useStore = create<S>()(persist((set) => ({
  user: null, setUser: (user) => set({ user }),
  draft: "", draftType: "website", model: "gpt-5", setDraft: (d) => set(d),
  theme: "system", setTheme: (theme) => set({ theme }),
  toasts: [], toast: (text) => { const id = Date.now(); set((s) => ({ toasts: [...s.toasts, { id, text }] })); setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2600); }, dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  sheet: null, openSheet: (sheet) => set({ sheet }), closeSheet: () => set({ sheet: null }),
  credits: null, setCredits: (credits) => set({ credits }),
}), { name: "purpio", storage: createJSONStorage(() => idb), partialize: (s) => ({ draft: s.draft, draftType: s.draftType, model: s.model, theme: s.theme }) as any }));
