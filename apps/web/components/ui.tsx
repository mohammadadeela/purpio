"use client";
import React, { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";

export function Logo({ size = 34 }: { size?: number }) {
  return (<svg className="logo" width={size} height={size} viewBox="0 0 512 512" aria-label="Purpio"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8B5CF6" /><stop offset="1" stopColor="#4F46E5" /></linearGradient></defs><rect x="32" y="32" width="448" height="448" rx="118" fill="url(#lg)" /><rect x="150" y="128" width="52" height="256" rx="26" fill="#fff" /><path className="bowl" d="M176 154 H290 a76 76 0 0 1 0 152 H176" fill="none" stroke="#fff" strokeWidth="52" strokeLinecap="round" strokeLinejoin="round" /><path className="spark" d="M352 318 L404 344 L378 352 L390 382 L372 388 L362 360 L344 376 Z" fill="#fff" /></svg>);
}
/** Primary buttons get a ripple from the click point, a sheen on hover and 0.98 scale on press (CSS). */
export function Button({ variant = "default", size, loading, children, className = "", onClick, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "default" | "ghost" | "danger"; size?: "sm" | "lg"; loading?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (<button ref={ref} className={`btn ${variant} ${size ?? ""} ${className}`} disabled={loading || rest.disabled} onClick={(e) => { if (variant === "primary" && ref.current) { const r = document.createElement("span"); r.className = "ripple"; const rc = ref.current.getBoundingClientRect(); const s = Math.max(rc.width, rc.height); r.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - rc.left - s / 2}px;top:${e.clientY - rc.top - s / 2}px`; ref.current.appendChild(r); setTimeout(() => r.remove(), 600); } onClick?.(e); }} {...rest}>{loading ? <span className="spinner" aria-hidden /> : null}{children}</button>);
}
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)}><i /></button>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <div className="field"><label>{label}</label>{children}{hint && <span className="hint">{hint}</span>}</div>; }
export function Tag({ kind, children }: { kind?: "ok" | "warn" | "bad" | "brand"; children: React.ReactNode }) { return <span className={`tag ${kind ?? ""}`}>{children}</span>; }
export function Toasts() { const t = useStore((s) => s.toasts); return <div className="toasts" aria-live="polite">{t.map((x) => <div key={x.id} className="toast">{x.text}</div>)}</div>; }
export function Sheet() { const { sheet, closeSheet } = useStore(); useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && closeSheet(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [closeSheet]); if (!sheet) return null;
  return <div className="overlay open" onClick={(e) => e.target === e.currentTarget && closeSheet()}><div className="sheet" role="dialog" aria-modal>{sheet}</div></div>; }
export const fmt = (n: number) => n.toLocaleString("en-US");
export function Skeleton({ h = 16, w = "100%" }: { h?: number; w?: string | number }) { return <div className="shimmer" style={{ height: h, width: w }} />; }
export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) { return <div className="card flat" style={{ textAlign: "center", padding: 36 }}><b>{title}</b><p className="muted" style={{ margin: "6px 0 14px" }}>{body}</p>{action}</div>; }
