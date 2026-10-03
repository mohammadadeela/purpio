"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInEmail, signInGithub, signInGoogle, signUpEmail, resetPassword } from "@/lib/firebase";
import { Button, Field, Logo } from "@/components/ui";
import { useStore } from "@/lib/store";
export default function Page() { return <Suspense><Login /></Suspense>; }
function Login() {
  const sp = useSearchParams(); const router = useRouter(); const { toast, setUser } = useStore(); const next = sp.get("next") ?? "/"; const ref = sp.get("ref") ?? undefined;
  const [mode, setMode] = useState<"in" | "up" | "reset">("in"); const [f, setF] = useState({ name: "", email: "", password: "" }); const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<any>) { setBusy(true); try { const r = await fn(); if (r?.user) setUser(r.user); if (mode === "reset") { toast("Reset link sent"); setMode("in"); } else router.push(r?.isNew ? `/?welcome=1&next=${encodeURIComponent(next)}` : next); } catch (e: any) { toast(e.message?.includes("auth/") ? "Email or password is not right" : e.message); } finally { setBusy(false); } }
  return (<div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}><div className="card" style={{ width: 400, padding: 28 }}>
    <div className="row" style={{ marginBottom: 18 }}><Logo size={38} /><b style={{ fontSize: 22, letterSpacing: "-.04em" }}>purpio.</b></div>
    <h1 style={{ fontSize: 22, marginBottom: 4 }}>{mode === "in" ? "Welcome back" : mode === "up" ? "Create your account" : "Reset your password"}</h1>
    <p className="muted" style={{ margin: "0 0 18px" }}>{mode === "up" ? "150 free credits. No card needed." : mode === "in" ? "Sign in to keep building." : "We will email you a link."}</p>
    {mode !== "reset" && <div className="grid g2" style={{ marginBottom: 14 }}><Button onClick={() => run(() => signInGoogle(ref))} disabled={busy}>Google</Button><Button onClick={() => run(() => signInGithub(ref))} disabled={busy}>GitHub</Button></div>}
    {mode === "up" && <Field label="Name"><input className="input" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>}
    <Field label="Email"><input className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
    {mode !== "reset" && <Field label="Password"><input className="input" type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} onKeyDown={(e) => e.key === "Enter" && run(() => mode === "in" ? signInEmail(f.email, f.password) : signUpEmail(f.name, f.email, f.password, ref))} /></Field>}
    <Button variant="primary" size="lg" style={{ width: "100%" }} loading={busy} onClick={() => run(() => mode === "in" ? signInEmail(f.email, f.password) : mode === "up" ? signUpEmail(f.name, f.email, f.password, ref) : resetPassword(f.email))}>{mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}</Button>
    <div className="row" style={{ justifyContent: "space-between", marginTop: 14, fontSize: 13 }}>{mode === "in" ? <><a href="#" onClick={(e) => { e.preventDefault(); setMode("up"); }}>Create an account</a><a href="#" onClick={(e) => { e.preventDefault(); setMode("reset"); }}>Forgot password?</a></> : <a href="#" onClick={(e) => { e.preventDefault(); setMode("in"); }}>Back to sign in</a>}</div>
  </div></div>);
}
