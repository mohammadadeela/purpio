"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { Home, Folder, LayoutTemplate, Tag, CreditCard, Shield, HelpCircle, Settings, Search, SunMoon } from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Logo, Toasts, Sheet, fmt } from "./ui";
import { TopupSheet } from "./TopupSheet";

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 7 * 864e5 } } });
const persister = typeof window !== "undefined" ? createSyncStoragePersister({ storage: window.localStorage }) : undefined;
const NAV = [["/", Home, "Home"], ["/projects", Folder, "My projects"], ["/templates", LayoutTemplate, "Templates"], ["/ideas", Tag, "Idea cards"], ["/pricing", CreditCard, "Pricing"]] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const Provider = persister ? PersistQueryClientProvider : QueryClientProvider;
  return <Provider client={qc} {...(persister ? { persistOptions: { persister } } : {})}><Inner>{children}</Inner><Toasts /><Sheet /></Provider>;
}
function Inner({ children }: { children: React.ReactNode }) {
  const path = usePathname(); const router = useRouter(); const { user, setUser, theme, setTheme, credits, setCredits, openSheet, toast } = useStore();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api("/auth/me"), retry: false });
  const bill = useQuery({ queryKey: ["billing"], queryFn: () => api("/billing"), enabled: !!me.data });
  useEffect(() => { if (me.data?.user) setUser(me.data.user); }, [me.data, setUser]);
  useEffect(() => { if (bill.data?.credits) setCredits(bill.data.credits); }, [bill.data, setCredits]);
  useEffect(() => { document.documentElement.dataset.theme = theme === "system" ? "" : theme; }, [theme]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); router.push("/projects?focus=search"); } }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [router]);
  const max = bill.data?.subscription?.plan?.creditsPerPeriod ?? 150; const avail = credits?.available ?? 0; const pct = Math.max(0, Math.min(100, Math.round((avail / max) * 100)));
  const bare = path === "/login";
  if (bare) return <>{children}</>;
  return (<div className="app">
    <aside className="side">
      <Link className="brand" href="/"><Logo /><span>purpio<span className="dot" /></span></Link>
      <div className="ws"><div className="av">{(user?.name ?? "P")[0].toUpperCase()}</div><div><b>{user ? "Personal workspace" : "Welcome"}</b><small>{user ? "Creator workspace" : "Sign in to save projects"}</small></div></div>
      <Link className="btn primary" href="/" style={{ justifyContent: "flex-start" }}>+ New project</Link>
      <nav className="nav">{NAV.map(([href, Icon, label]) => <Link key={href} href={href} className={(href === "/" ? path === "/" : path.startsWith(href)) ? "on" : ""}><Icon size={18} /> {label}</Link>)}{user?.role === "admin" && <Link href="/admin" className={path.startsWith("/admin") ? "on" : ""}><Shield size={18} /> Admin</Link>}</nav>
      <div className="spacer" />
      {user && <div className="credits"><div className="row" style={{ justifyContent: "space-between" }}><b>{fmt(avail)} credits</b><button className="pill brand" style={{ fontSize: 12 }} onClick={() => openSheet(<TopupSheet />)}>Buy credits</button></div><div className="bar"><i style={{ width: `${pct}%` }} /></div><small>{avail <= 0 ? "Out of credits" : `${pct}% of ${fmt(max)} · renews ${bill.data?.subscription ? new Date(bill.data.subscription.currentPeriodEnd).toLocaleDateString() : "—"}`}</small></div>}
      <div className="nav"><Link href="/help"><HelpCircle size={18} /> Help &amp; shortcuts</Link><Link href="/settings"><Settings size={18} /> Settings</Link></div>
    </aside>
    <main style={{ minWidth: 0 }}>
      <header className="top"><div className="crumb">Workspace <span style={{ margin: "0 6px" }}>›</span> <b>{path === "/" ? "Home" : path.split("/")[1][0].toUpperCase() + path.split("/")[1].slice(1)}</b></div><div className="grow" />
        <button className="search" onClick={() => router.push("/projects?focus=search")}><Search size={16} /> Search anything… <kbd>⌘K</kbd></button>
        <button className="iconbtn" aria-label="Theme" onClick={() => { const o = ["light", "dark", "system"] as const; const n = o[(o.indexOf(theme) + 1) % 3]; setTheme(n); toast(`Theme: ${n}`); }}><SunMoon size={18} /></button>
        {user ? <><button className="pill" onClick={() => openSheet(<TopupSheet />)}>◆ {fmt(avail)}</button><Link className="iconbtn" href="/settings" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)", fontWeight: 600 }}>{(user.name ?? "P")[0].toUpperCase()}</Link></> : <Link className="btn primary sm" href="/login">Sign in</Link>}
      </header>
      {children}
    </main></div>);
}
