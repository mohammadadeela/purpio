"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import * as I from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button, fmt } from "./ui";
import { TopupSheet } from "./TopupSheet";
const ICONS: Record<string, any> = { chat: I.MessageCircle, phone: I.Smartphone, table: I.Table, bot: I.Bot, video: I.Video, camera: I.Camera, slides: I.GalleryHorizontal, cal: I.Calendar, card: I.CreditCard, globe: I.Globe, pen: I.PenLine, chart: I.BarChart3, tag: I.Tag, cube: I.Box, brand: I.Sparkles, mail: I.Mail, deck: I.Presentation, moon: I.Moon, star: I.Star, lock: I.Lock };
export function IdeaGrid({ limit, projectId }: { limit?: number; projectId?: string }) {
  const { data } = useQuery({ queryKey: ["ideas"], queryFn: () => api("/ideas") }); const { openSheet, closeSheet, toast, user } = useStore(); const router = useRouter();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api("/projects"), enabled: !!user && !projectId });
  function use(card: any) {
    const target = projectId ?? projects.data?.[0]?.id;
    if (!user) return router.push("/login");
    if (!target) { toast("Describe a project first, then the card applies to it"); return; }
    openSheet(<><h2 style={{ fontSize: 20 }}>Add {card.title}</h2><p className="sub">Estimated {fmt(card.creditEstimate)} credits; you pay the exact cost after.</p><div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}><Button variant="ghost" onClick={closeSheet}>Cancel</Button><Button variant="primary" onClick={async () => { closeSheet(); try { await api(`/projects/${target}/chat`, { method: "POST", json: { content: card.promptTemplate, modelKey: "gpt-5" } }); toast(`${card.title} is being added`); router.push(`/p/${target}`); } catch (e) { const err = e as ApiError; if (err.body?.topup) openSheet(<TopupSheet need={err.body.need} />); else toast(err.message); } }}>Add · {fmt(card.creditEstimate)} credits</Button></div></>);
  }
  return <div className="ideas">{(data ?? []).slice(0, limit ?? 99).map((c: any) => { const Icon = ICONS[c.icon] ?? I.Sparkles; return <button key={c.key} className="idea" onClick={() => use(c)}><span className="ic"><Icon size={18} /></span><b>{c.title}</b><p>{c.description}</p><span className="cost">~{fmt(c.creditEstimate)} credits · add</span></button>; })}</div>;
}
export function ProjectCard({ p }: { p: any }) {
  const hues = ["#7C3AED,#4F46E5", "#0EA5E9,#6366F1", "#F43F5E,#8B5CF6", "#10B981,#0EA5E9"]; const h = hues[p.id.charCodeAt(p.id.length - 1) % 4];
  return <Link className="proj" href={`/p/${p.id}`}><div className="thumb" style={{ background: p.coverUrl ? `url(${p.coverUrl}) center/cover` : `linear-gradient(135deg,${h})` }}>{!p.coverUrl && <span style={{ fontWeight: 600, color: "#fff", textShadow: "0 1px 6px rgba(0,0,0,.3)" }}>{p.name}</span>}</div><div className="meta"><b>{p.name}</b><small>{p.type} · {p.status === "building" ? "building…" : new Date(p.updatedAt).toLocaleDateString()}</small></div></Link>;
}
