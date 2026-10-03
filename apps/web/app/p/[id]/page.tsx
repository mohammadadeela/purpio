"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Rocket, Code2 } from "lucide-react";
import type { StreamEvent } from "@purpio/shared";
import { api, ApiError, wsUrl } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button, fmt, Skeleton, Tag } from "@/components/ui";
import { TopupSheet } from "@/components/TopupSheet";
import { IdeaGrid } from "@/components/cards";
const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type Step = { file: string; status: "run" | "done" };
type Live = { thinking: string; steps: Step[]; done?: StreamEvent & { type: "done" }; error?: string };

export default function Builder({ params }: { params: { id: string } }) {
  const id = params.id; const qc = useQueryClient(); const router = useRouter(); const sp = useSearchParams(); const { openSheet, toast, user, setCredits } = useStore();
  const q = useQuery({ queryKey: ["project", id], queryFn: () => api(`/projects/${id}`) });
  const models = useQuery({ queryKey: ["models"], queryFn: () => api("/models") });
  const [live, setLive] = useState<Live | null>(null); const [tab, setTab] = useState<string>(sp.get("tab") ?? "preview"); const [device, setDevice] = useState<"desktop" | "tablet" | "phone">("desktop");
  const [input, setInput] = useState(""); const [model, setModel] = useState<string>(user?.defaultModel ?? "gpt-5"); const [previewUrl, setPreviewUrl] = useState<string | null>(null); const msgs = useRef<HTMLDivElement>(null);
  const p = q.data?.project;
  // Live events
  useEffect(() => { const ws = new WebSocket(wsUrl(`/projects/${id}/events`)); ws.onmessage = (m) => { const ev = JSON.parse(m.data) as StreamEvent;
      setLive((l) => { const n: Live = l ?? { thinking: "", steps: [] };
        if (ev.type === "thinking") return { ...n, thinking: n.thinking + ev.text };
        if (ev.type === "step") { const steps = n.steps.filter((s) => s.file !== ev.file); return { ...n, steps: [...steps, { file: ev.file, status: ev.status }] }; }
        if (ev.type === "preview") { setPreviewUrl(ev.url); return n; }
        if (ev.type === "done") { qc.invalidateQueries({ queryKey: ["project", id] }); qc.invalidateQueries({ queryKey: ["billing"] }); api("/billing").then((b) => setCredits(b.credits)); return { ...n, done: ev }; }
        if (ev.type === "error") { toast(ev.message); qc.invalidateQueries({ queryKey: ["billing"] }); return { ...n, error: ev.message }; }
        return n; }); };
    return () => ws.close(); }, [id, qc, toast, setCredits]);
  useEffect(() => { if (p?.previewUrl) setPreviewUrl(p.previewUrl); }, [p?.previewUrl]);
  useEffect(() => { msgs.current?.scrollTo(0, 1e9); }, [live, q.data]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") { e.preventDefault(); if (e.shiftKey) setTab("deploy"); else setDevice((d) => (d === "desktop" ? "tablet" : d === "tablet" ? "phone" : "desktop")); } }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
  const building = (q.data?.activeJobs?.length ?? 0) > 0 || (!!live && !live.done && !live.error);
  async function send(selector?: string) { const t = input.trim(); if (!t) return; setInput(""); setLive({ thinking: "", steps: [] });
    try { await api(`/projects/${id}/chat`, { method: "POST", json: { content: t, modelKey: model, selector } }); qc.invalidateQueries({ queryKey: ["project", id] }); }
    catch (e) { const err = e as ApiError; if (err.body?.topup) openSheet(<TopupSheet need={err.body.need} />); else toast(err.message); setLive(null); } }
  const est = Math.round(40 * (models.data?.find((m: any) => m.key === model)?.multiplier ?? 1));
  if (q.isLoading) return <div className="page"><Skeleton h={400} /></div>;
  if (!p) return <div className="page">Project not found.</div>;
  return (<div className="builder">
    <section className="chat">
      <div className="msgs" ref={msgs}>
        {q.data.messages.map((m: any) => m.role === "user" ? <div key={m.id} className="msg user"><div className="b">{m.content}</div></div> : <div key={m.id} className="msg ai"><div className="b">{m.thinking && <details className="think done"><summary>Thought for {Math.max(1, Math.round(m.durationMs / 1000))} seconds</summary><div className="body">{m.thinking}</div></details>}<p style={{ margin: "6px 0 0" }}>{m.content}</p><div className="costline">Used {fmt(m.creditsUsed)} credits · {m.modelKey}</div></div></div>)}
        {(live || building) && !live?.done && <div className="msg ai"><div className="b">
          <details className={`think ${live?.error ? "done" : ""}`} open><summary>{live?.error ? "Stopped" : "Thinking"}</summary><div className="body">{live?.thinking || "Starting…"}</div></details>
          <div className="steps">{live?.steps.map((s) => <div key={s.file} className={`step ${s.status}`}><span className="ck">{s.status === "done" ? "✓" : ""}</span><span>{s.status === "done" ? "Wrote" : "Writing"} <code>{s.file}</code></span></div>)}</div>
        </div></div>}
        {live?.done && <div className="msg ai"><div className="b"><div className="actions"><Button size="sm" onClick={() => setTab("deploy")}><Rocket size={16} /> Deploy</Button><Button size="sm" onClick={() => setTab("files")}><Code2 size={16} /> Source code</Button><Button size="sm" onClick={() => setTab("media")}>Promo video · 1,200</Button></div></div></div>}
      </div>
      <div className="chatbox"><div className="composer"><textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Change anything… e.g. make the hero darker and add a pricing table" aria-label="Instruction" />
        <div className="bar"><div className="modelpick"><select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">{(models.data ?? []).filter((m: any) => m.multiplier != null).map((m: any) => <option key={m.key} value={m.key} disabled={m.locked}>{m.label} · {m.multiplier}×{m.locked ? " · Pro" : ""}</option>)}</select></div><span className="muted">~{est} credits</span><button className="send" aria-label="Send" onClick={() => send()} disabled={building}>▲</button></div></div></div>
    </section>
    <section className="preview">
      <div className="ptabs">{["preview", "files", "versions", "media", "deploy", "ideas"].map((t) => <button key={t} className={`ptab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        <div className="devices">{(["desktop", "tablet", "phone"] as const).map((d) => <button key={d} className={device === d ? "on" : ""} onClick={() => setDevice(d)}>{d[0].toUpperCase() + d.slice(1)}</button>)}</div>
        {previewUrl && <a className="iconbtn" href={previewUrl} target="_blank" rel="noreferrer" title="Open in new tab">↗</a>}</div>
      {tab === "preview" && <div className="frame">{previewUrl ? <iframe title="Live preview" src={previewUrl} style={{ width: { desktop: "100%", tablet: "768px", phone: "390px" }[device], height: "100%" }} sandbox="allow-scripts allow-same-origin allow-forms" /> : <div className="empty"><div className="shimmer" style={{ height: 160, width: 320, margin: "0 auto 14px" }} /><b>{building ? "Building your preview" : "No preview yet"}</b><p>{building ? "Sections appear here as each file lands." : "Send an instruction to start."}</p></div>}</div>}
      {tab === "files" && <FilesTab id={id} />}
      {tab === "versions" && <div className="panel"><div className="card flat"><table className="t"><thead><tr><th>Version</th><th>Change</th><th>When</th><th></th></tr></thead><tbody>{q.data.versions.map((v: any, i: number) => <tr key={v.id}><td><b>v{v.number}</b> {i === 0 && <Tag kind="ok">current</Tag>}</td><td>{v.message}</td><td className="muted">{new Date(v.createdAt).toLocaleString()}</td><td style={{ textAlign: "right" }}>{i > 0 && <Button size="sm" onClick={async () => { await api(`/projects/${id}/versions/${v.number}/restore`, { method: "POST" }); toast(`Restored v${v.number}`); qc.invalidateQueries({ queryKey: ["project", id] }); }}>Restore</Button>}</td></tr>)}</tbody></table></div></div>}
      {tab === "media" && <MediaTab id={id} media={q.data.media} />}
      {tab === "deploy" && <DeployTab id={id} p={p} deployments={q.data.deployments} live={live} />}
      {tab === "ideas" && <div className="panel"><IdeaGrid projectId={id} /></div>}
    </section></div>);
}

function FilesTab({ id }: { id: string }) {
  const { toast } = useStore(); const q = useQuery({ queryKey: ["files", id], queryFn: () => api(`/projects/${id}/files?full=1`) }); const [sel, setSel] = useState<string | null>(null); const [val, setVal] = useState("");
  const files: any[] = q.data?.files ?? []; const cur = files.find((f) => f.path === sel) ?? files[0];
  useEffect(() => { if (cur) { setSel(cur.path); setVal(cur.content ?? ""); } }, [cur?.path]);
  if (!files.length) return <div className="panel"><div className="card flat muted">No source yet.</div></div>;
  const lang = { ts: "typescript", tsx: "typescript", js: "javascript", css: "css", json: "json", md: "markdown", html: "html", prisma: "prisma" }[(cur?.path.split(".").pop() ?? "") as string] ?? "plaintext";
  return <div className="panel"><div className="grid" style={{ gridTemplateColumns: "240px 1fr", gap: 14, height: "100%" }}><div className="card flat ftree" style={{ overflow: "auto" }}>{files.map((f) => <div key={f.path} onClick={() => { setSel(f.path); setVal(f.content ?? ""); }} style={{ background: f.path === sel ? "var(--surface2)" : undefined }}>{f.path}</div>)}</div>
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}><div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}><b>{cur?.path}</b><div className="row"><Button size="sm" onClick={async () => { await api(`/projects/${id}/files`, { method: "PUT", json: { path: cur.path, content: val } }); toast("Saved"); }}>Save</Button><Button size="sm" onClick={() => api(`/projects/${id}/deploy`, { method: "POST", json: { provider: "zip" } }).then(() => toast("Zip is being prepared; see Deploy tab"))}>Download zip</Button><Button size="sm" onClick={() => api(`/projects/${id}/deploy`, { method: "POST", json: { provider: "github" } }).then(() => toast("Pushing to GitHub")).catch((e) => toast(e.message))}>Push to GitHub</Button></div></div>
      <div style={{ flex: 1, minHeight: 300, border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}><Monaco height="100%" language={lang} value={val} onChange={(v) => setVal(v ?? "")} theme={document.documentElement.dataset.theme === "dark" ? "vs-dark" : "light"} options={{ minimap: { enabled: false }, fontSize: 13 }} /></div></div></div></div>;
}
function MediaTab({ id, media }: { id: string; media: any[] }) {
  const { toast, openSheet } = useStore(); const [prompt, setPrompt] = useState(""); const [kind, setKind] = useState<"image" | "video">("image"); const [dur, setDur] = useState(10);
  async function gen() { try { await api(`/projects/${id}/media`, { method: "POST", json: { kind, prompt: prompt || "hero image for this project", durationS: kind === "video" ? dur : undefined, count: 1 } }); toast(`${kind === "image" ? "Image" : "Video"} is generating`); } catch (e) { const err = e as ApiError; if (err.body?.topup) openSheet(<TopupSheet need={err.body.need} />); else toast(err.message); } }
  return <div className="panel"><div className="card" style={{ marginBottom: 14 }}><div className="row wrap"><select className="input" style={{ width: 120 }} value={kind} onChange={(e) => setKind(e.target.value as any)}><option value="image">Image · 8</option><option value="video">Video · 80/s</option></select>{kind === "video" && <select className="input" style={{ width: 100 }} value={dur} onChange={(e) => setDur(+e.target.value)}>{[5, 10, 15, 30, 60].map((d) => <option key={d} value={d}>{d} s</option>)}</select>}<input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="e.g. a hero image of our bakery at sunrise" value={prompt} onChange={(e) => setPrompt(e.target.value)} /><Button variant="primary" onClick={gen}>Generate · {kind === "image" ? 8 : 80 * dur} credits</Button></div><p className="muted" style={{ margin: "8px 0 0" }}>Generated with Gemini and matched to this project's palette automatically.</p></div>
    <div className="grid g3">{media.length ? media.map((m) => <div key={m.id} className="card flat" style={{ padding: 0, overflow: "hidden" }}>{m.kind === "video" ? <video src={m.url} controls style={{ width: "100%", height: 160, objectFit: "cover" }} /> : <img src={m.url} alt={m.prompt} style={{ width: "100%", height: 160, objectFit: "cover" }} />}<div style={{ padding: 10 }} className="row"><small className="muted">{m.width ? `${m.width}×${m.height}` : `${m.durationS} s`}</small><a className="btn sm ghost" style={{ marginLeft: "auto" }} href={m.url} download>Download</a></div></div>) : <div className="card flat muted" style={{ gridColumn: "1/-1", textAlign: "center", padding: 30 }}>No media yet. Images and videos you generate for this project appear here.</div>}</div></div>;
}
function DeployTab({ id, p, deployments, live }: { id: string; p: any; deployments: any[]; live: Live | null }) {
  const { toast, openSheet } = useStore(); const router = useRouter(); const [sub, setSub] = useState(p.slug); const [domain, setDomain] = useState("");
  const conns = useQuery({ queryKey: ["connections"], queryFn: () => api("/connections") }); const host = conns.data?.find((c: any) => c.name === "HOSTINGER_API_TOKEN");
  async function go(provider: string) { try { await api(`/projects/${id}/deploy`, { method: "POST", json: { provider, subdomain: sub, domain: domain || undefined } }); toast("Deploying…"); } catch (e) { const err = e as ApiError; if (err.body?.topup) openSheet(<TopupSheet need={err.body.need} />); else if (err.body?.upgrade) router.push("/pricing"); else toast(err.message); } }
  const last = deployments[0];
  return <div className="panel"><div className="grid g2"><div className="card"><h3>Purpio subdomain</h3><p className="muted">Free, instant, SSL included.</p><div className="row"><input className="input" value={sub} onChange={(e) => setSub(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} style={{ flex: 1 }} /><span className="muted">.purpio.app</span></div><Button variant="primary" style={{ marginTop: 12 }} onClick={() => go("purpio_subdomain")}><Rocket size={16} /> Deploy · 4 credits</Button></div>
    <div className="card"><h3>Your Hostinger</h3>{host?.connected ? <p className="muted">Uses your encrypted token <span className="secret">hst_••••••••{host.last4}</span> 🔒</p> : <p className="muted">Connect Hostinger in <a href="/settings/connections" style={{ color: "var(--brand-ink)" }}>Settings, Connections</a> first.</p>}<div className="field"><label>Domain in your Hostinger account</label><input className="input" placeholder="yourdomain.com" autoComplete="url" value={domain} onChange={(e) => setDomain(e.target.value)} /></div><p className="lock">🔒 Project secrets are injected at build time, never written into files.</p><Button variant="primary" disabled={!host?.connected || !domain} onClick={() => go("hostinger")}><Rocket size={16} /> Deploy to Hostinger · 4 credits</Button></div></div>
    <div className="card" style={{ marginTop: 16 }}><h3>Deploy log</h3><pre className="code" style={{ minHeight: 120, marginTop: 10 }}>{live && !live.done ? live.thinking : last ? last.log || (last.url ? `✓ Live at ${last.url}` : "") : "Nothing deployed yet."}</pre>{last?.url && <a className="btn sm" style={{ marginTop: 10 }} href={last.url} target="_blank" rel="noreferrer">Open {last.url}</a>}</div>
    {deployments.length > 1 && <div className="card" style={{ marginTop: 16 }}><h3>History</h3><table className="t"><tbody>{deployments.map((d) => <tr key={d.id}><td>{d.provider}</td><td><Tag kind={d.status === "live" ? "ok" : d.status === "failed" ? "bad" : undefined}>{d.status}</Tag></td><td className="muted">{new Date(d.createdAt).toLocaleString()}</td><td>{d.url && <a href={d.url} target="_blank" rel="noreferrer">{d.url}</a>}</td></tr>)}</tbody></table></div>}</div>;
}
