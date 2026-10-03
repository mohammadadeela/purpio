"use client";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
export default function Templates() { const { data } = useQuery({ queryKey: ["templates"], queryFn: () => api("/templates") }); const { setDraft, toast } = useStore(); const router = useRouter();
  const g = ["#F97316,#EF4444", "#8B5CF6,#4F46E5", "#0EA5E9,#2563EB", "#10B981,#059669", "#F43F5E,#BE185D", "#6366F1,#0EA5E9", "#14121F,#514B66", "#D97706,#EA580C"];
  return <div className="page"><h1 style={{ fontSize: 24, marginBottom: 6 }}>Templates</h1><p className="sub" style={{ margin: "0 0 18px" }}>Real starting points with admin areas, legal pages and seeded content. Pick one and keep talking.</p>
    <div className="grid g4">{(data ?? []).map((t: any, i: number) => <button key={t.key} className="proj" style={{ textAlign: "left" }} onClick={() => { setDraft({ draft: t.promptSeed, draftType: t.type }); toast("Template loaded, adjust and press create"); router.push("/"); }}><div className="thumb" style={{ background: t.coverUrl ? `url(${t.coverUrl}) center/cover` : `linear-gradient(135deg,${g[i % g.length]})` }}><span style={{ color: "#fff", fontWeight: 600 }}>{t.name}</span></div><div className="meta"><b>{t.name}</b><small>{t.type} · Use this</small></div></button>)}</div></div>; }
