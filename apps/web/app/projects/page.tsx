"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ProjectCard } from "@/components/cards";
import { Empty, Skeleton } from "@/components/ui";
export default function Projects() { const [q, setQ] = useState(""); const { data, isLoading } = useQuery({ queryKey: ["projects"], queryFn: () => api("/projects") });
  const list = (data ?? []).filter((p: any) => p.name.toLowerCase().includes(q.toLowerCase()));
  return <div className="page"><div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}><h1 style={{ fontSize: 24 }}>My projects</h1><div className="row"><input className="input" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} autoFocus /><Link className="btn primary" href="/">+ New project</Link></div></div>
    <div className="grid g4">{isLoading ? [1, 2, 3, 4].map((i) => <Skeleton key={i} h={190} />) : list.length ? list.map((p: any) => <ProjectCard key={p.id} p={p} />) : <div style={{ gridColumn: "1/-1" }}><Empty title={q ? "No matches" : "Nothing here yet"} body="Your projects, versions and deployments will live here." action={<Link className="btn primary" href="/">Create your first project</Link>} /></div>}</div></div>; }
