import { redirect } from "next/navigation";
export default function Referral({ params }: { params: { code: string } }) { redirect(`/login?ref=${params.code}`); }
