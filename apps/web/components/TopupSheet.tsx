"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button, fmt } from "./ui";
export function TopupSheet({ need }: { need?: number }) {
  const { closeSheet, toast, setCredits, credits } = useStore(); const router = useRouter();
  const { data } = useQuery({ queryKey: ["catalog"], queryFn: () => api("/billing/catalog") });
  async function buy(key: string) { try { const r = await api("/billing/topup", { method: "POST", json: { packKey: key } }); setCredits(r.balance); closeSheet(); toast(`${fmt(r.credits)} credits added · receipt emailed`); } catch (e: any) { if (e.body?.needsCard) { closeSheet(); router.push(`/checkout?pack=${key}`); } else toast(e.message); } }
  return (<><h2 style={{ fontSize: 20 }}>{need ? `You need ${fmt(need)} credits for this run` : "Buy credits"}</h2><p className="sub">You have {fmt(credits?.available ?? 0)}. Add a pack and continue right where you stopped.</p>
    <div className="grid g2" style={{ margin: "16px 0" }}>{data?.packs?.map((p: any, i: number) => <button key={p.key} className="card flat" style={{ textAlign: "left", cursor: "pointer", borderColor: i === 3 ? "var(--brand)" : undefined }} onClick={() => buy(p.key)}><div className="row" style={{ justifyContent: "space-between" }}><b>{p.name}</b>{p.bonusPct ? <span className="tag brand">+{p.bonusPct}%</span> : null}</div><div className="muted">${(p.priceCents / 100).toFixed(0)} · one tap with your saved card</div></button>)}</div>
    <div className="row" style={{ justifyContent: "space-between" }}><span className="lock">🔒 Charged to your saved card. No redirect.</span><Button variant="ghost" onClick={closeSheet}>Not now</Button></div></>);
}
