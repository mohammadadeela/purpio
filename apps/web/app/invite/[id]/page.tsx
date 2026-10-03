"use client";
import { useEffect } from "react"; import { useRouter } from "next/navigation"; import { api } from "@/lib/api"; import { useStore } from "@/lib/store";
export default function Invite({ params }: { params: { id: string } }) { const router = useRouter(); const { toast } = useStore(); useEffect(() => { api(`/team/accept/${params.id}`, { method: "POST" }).then(() => { toast("You joined the workspace"); router.push("/projects"); }).catch((e) => { toast(e.message); router.push("/"); }); }, [params.id, router, toast]); return <div className="page">Joining…</div>; }
