"use client";
import { useEffect, useRef, useState } from "react";
/** Floating glass tiles that tilt toward the cursor. Pure CSS 3D with a static fallback for reduced motion / low power. */
export function HeroScene() {
  const ref = useRef<HTMLDivElement>(null); const [on, setOn] = useState(false);
  useEffect(() => { const rm = matchMedia("(prefers-reduced-motion: reduce)").matches; const low = (navigator as any).hardwareConcurrency < 4; setOn(!rm && !low); if (rm || low) return;
    const mv = (ev: MouseEvent) => { const el = ref.current; if (!el) return; const r = el.getBoundingClientRect(); const dx = (ev.clientX - r.left - r.width / 2) / r.width, dy = (ev.clientY - r.top - r.height / 2) / r.height; el.querySelectorAll<HTMLElement>(".tile").forEach((t, i) => (t.style.transform = `rotateY(${dx * 18 * (i % 2 ? 1 : -1)}deg) rotateX(${-dy * 14}deg) translateZ(${i * 6}px)`)); };
    addEventListener("mousemove", mv, { passive: true }); return () => removeEventListener("mousemove", mv); }, []);
  return <div ref={ref} className="scene" aria-hidden style={on ? undefined : { pointerEvents: "none" }}>{["Website", "Mobile app", "Image", "Video"].map((t) => <div key={t} className="tile" style={on ? undefined : { animation: "none" }}>{t}</div>)}</div>;
}
