"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BASE_ESTIMATE, type ProjectTypeT } from "@purpio/shared";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button, fmt, Empty } from "@/components/ui";
import { TopupSheet } from "@/components/TopupSheet";
import { IdeaGrid, ProjectCard } from "@/components/cards";
import { HeroScene } from "@/components/HeroScene";

const TYPES: [ProjectTypeT, string][] = [["website", "Website"], ["webapp", "Web app"], ["mobile", "Mobile app"], ["image", "Image"], ["video", "Video"]];
const TRY = [["A portfolio that feels like me ↗", "A portfolio that feels like me, with a case-study page and a contact form"], ["A dashboard for my business ↗", "A dashboard for my delivery business with orders, drivers map and daily revenue"], ["An app for my next big idea ↗", "A booking website for my barbershop with WhatsApp confirmations"]];

export default function Home() {
  const { draft, draftType, model, setDraft, user, openSheet, toast } = useStore(); const router = useRouter(); const [busy, setBusy] = useState(false); const ta = useRef<HTMLTextAreaElement>(null);
  const models = useQuery({ queryKey: ["models"], queryFn: () => api("/models"), enabled: !!user });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api("/projects"), enabled: !!user });
  const m = models.data?.find((x: any) => x.key === model); const est = draft.trim() ? Math.round(BASE_ESTIMATE[draftType] * (draftType === "image" || draftType === "video" ? 1 : m?.multiplier ?? 1)) : 0;
  useEffect(() => { const d = new URLSearchParams(location.search).get("prompt"); if (d) setDraft({ draft: d }); }, [setDraft]);
  async function go() {
    if (!draft.trim()) { toast("Describe what you want first"); ta.current?.focus(); return; }
    if (!user) { router.push(`/login?next=${encodeURIComponent("/?prompt=" + draft)}`); return; }
    setBusy(true);
    try { const r = await api("/projects", { method: "POST", json: { prompt: draft, type: draftType, modelKey: draftType === "image" ? "gemini-image" : draftType === "video" ? "gemini-video" : model } }); setDraft({ draft: "" }); router.push(`/p/${r.project.id}`); }
    catch (e) { const err = e as ApiError; if (err.body?.topup) openSheet(<TopupSheet need={err.body.need} />); else if (err.body?.upgrade) router.push("/pricing"); else toast(err.message); }
    finally { setBusy(false); }
  }
  return (<div className="page">
    <div className="hero">
      <span className="eyebrow">✦ A space for your next big idea</span>
      <h1>What will you <em>create?</em></h1>
      <p>Websites, apps, images, videos. One idea is all it takes.</p>
      <HeroScene />
      <div className="composer">
        <textarea ref={ta} value={draft} onChange={(e) => setDraft({ draft: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(); }} placeholder="Describe your idea. Let's bring it to life…" aria-label="Describe your idea" />
        <div className="bar"><Button size="sm" variant="ghost" onClick={() => toast("Paste a URL or drop an image into the box")}>＋ Attach a reference</Button>
          {draftType !== "image" && draftType !== "video" && <div className="modelpick"><select value={model} onChange={(e) => setDraft({ model: e.target.value })} aria-label="Model">{(models.data ?? [{ key: "gpt-5", label: "GPT-5" }]).filter((x: any) => x.multiplier != null).map((x: any) => <option key={x.key} value={x.key} disabled={x.locked}>{x.label}{x.locked ? " · Pro" : ""}</option>)}</select></div>}
          <span className="muted">{est ? `~${fmt(est)} credits` : ""}</span>
          <button className="send" aria-label="Create" onClick={go} disabled={busy}>{busy ? "…" : "▲"}</button></div>
      </div>
      <div className="types">{TYPES.map(([k, l]) => <button key={k} className={`type ${draftType === k ? "on" : ""}`} onClick={() => setDraft({ draftType: k })}>{l}</button>)}</div>
      <div className="ortry">Or try {TRY.map(([l, p]) => <a key={l} href="#" onClick={(e) => { e.preventDefault(); setDraft({ draft: p }); ta.current?.focus(); }}>{l}</a>)}</div>
    </div>
    <div className="row" style={{ justifyContent: "space-between", margin: "36px 0 12px" }}><h2 className="h-sec" style={{ margin: 0 }}>Your workspace</h2><Link href="/projects" className="sub">View all projects ↗</Link></div>
    <div className="grid g4">{projects.data?.length ? projects.data.slice(0, 4).map((p: any) => <ProjectCard key={p.id} p={p} />) : <div style={{ gridColumn: "1/-1" }}><Empty title={user ? "No projects yet" : "Sign in to keep your projects"} body="Describe something above. Your first build is free." /></div>}</div>
    <div className="row" style={{ justifyContent: "space-between", margin: "36px 0 12px" }}><h2 className="h-sec" style={{ margin: 0 }}>Add to any project in one click</h2><Link href="/ideas" className="sub">All idea cards ↗</Link></div>
    <IdeaGrid limit={8} />
  </div>);
}
