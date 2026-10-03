import { Body, Button, Container, Head, Heading, Html, Img, Preview, Section, Text } from "@react-email/components";
import { render } from "@react-email/components";
import { Resend } from "resend";

const brand = { violet: "#7C3AED", ink: "#14121F", muted: "#8B86A0", canvas: "#F7F6FB" };
const APP = process.env.APP_URL ?? "https://purpio.com";

function Layout({ preview, title, children, cta }: { preview: string; title: string; children: React.ReactNode; cta?: { label: string; href: string } }) {
  return (
    <Html><Head /><Preview>{preview}</Preview>
      <Body style={{ background: brand.canvas, fontFamily: "Inter, -apple-system, Segoe UI, Roboto, sans-serif", margin: 0, padding: "32px 0" }}>
        <Container style={{ background: "#fff", borderRadius: 16, padding: 32, maxWidth: 520 }}>
          <Img src={`${APP}/icon-192.png`} width="40" height="40" alt="Purpio" />
          <Heading style={{ fontSize: 22, color: brand.ink, margin: "20px 0 8px", letterSpacing: "-0.01em" }}>{title}</Heading>
          <Section style={{ color: brand.ink, fontSize: 15, lineHeight: "24px" }}>{children}</Section>
          {cta && <Button href={cta.href} style={{ background: brand.violet, color: "#fff", borderRadius: 10, padding: "12px 18px", fontWeight: 600, marginTop: 16 }}>{cta.label}</Button>}
          <Text style={{ color: brand.muted, fontSize: 12, marginTop: 28 }}>Purpio · You receive this because you have a Purpio account. Manage notifications in Settings.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export const templates = {
  welcome: (p: { name: string }) => ({ subject: "Welcome to Purpio, here is your first project", body: <Layout preview="Your studio is ready" title={`Welcome, ${p.name}`} cta={{ label: "Start building", href: `${APP}/` }}><Text>Describe anything, watch it build live, deploy in one click. Your free credits are already in your account.</Text></Layout> }),
  verifyEmail: (p: { link: string }) => ({ subject: "Confirm your email", body: <Layout preview="Confirm your email" title="Confirm your email" cta={{ label: "Confirm email", href: p.link }}><Text>Press the button to verify this address. The link works for 24 hours.</Text></Layout> }),
  passwordReset: (p: { link: string }) => ({ subject: "Reset your Purpio password", body: <Layout preview="Reset your password" title="Reset your password" cta={{ label: "Choose a new password", href: p.link }}><Text>If you did not ask for this, ignore this email; your password stays the same.</Text></Layout> }),
  newDevice: (p: { device: string; where: string }) => ({ subject: "New sign-in to your account", body: <Layout preview="New sign-in" title="New sign-in" cta={{ label: "Review sessions", href: `${APP}/settings/security` }}><Text>{p.device} signed in from {p.where}. If this was not you, sign out everywhere and change your password.</Text></Layout> }),
  receipt: (p: { number: string; amount: string; pdf: string }) => ({ subject: `Receipt ${p.number}, ${p.amount}`, body: <Layout preview={`Receipt ${p.number}`} title="Thanks for your payment" cta={{ label: "Download invoice", href: p.pdf }}><Text>We charged {p.amount}. Invoice {p.number} is attached and in Settings, Invoices.</Text></Layout> }),
  planActive: (p: { plan: string; credits: number; renews: string }) => ({ subject: `Your ${p.plan} plan is active`, body: <Layout preview="Plan active" title={`You're on ${p.plan}`}><Text>{p.credits.toLocaleString()} credits are in your account. Your plan renews on {p.renews}.</Text></Layout> }),
  renewalReminder: (p: { date: string; amount: string }) => ({ subject: `Your plan renews on ${p.date}`, body: <Layout preview="Renewal reminder" title="Renewal in 3 days" cta={{ label: "Manage billing", href: `${APP}/settings/billing` }}><Text>We will charge {p.amount} to your default card on {p.date}. Change or cancel any time before then.</Text></Layout> }),
  renewalFailed: (p: { retryDate: string }) => ({ subject: "We could not charge your card", body: <Layout preview="Payment failed" title="Payment failed" cta={{ label: "Update card", href: `${APP}/settings/billing` }}><Text>Your bank declined the renewal. We will try again on {p.retryDate}. Update your card to keep your plan.</Text></Layout> }),
  cancelled: (p: { ends: string }) => ({ subject: `Your plan ends on ${p.ends}`, body: <Layout preview="Plan cancelled" title="Plan cancelled"><Text>You keep every project and its source code. Credits stay usable until {p.ends}.</Text></Layout> }),
  creditsLow: (p: { left: number }) => ({ subject: `You have ${p.left} credits left`, body: <Layout preview="Credits running low" title="Credits running low" cta={{ label: "Buy credits", href: `${APP}/settings/billing` }}><Text>{p.left} credits remain. Add a pack now so your next build does not stop.</Text></Layout> }),
  creditsOut: () => ({ subject: "You are out of credits", body: <Layout preview="Out of credits" title="Out of credits" cta={{ label: "Buy credits", href: `${APP}/settings/billing` }}><Text>Builds pause until you add credits. Packs start at $10 and apply instantly.</Text></Layout> }),
  topup: (p: { credits: number }) => ({ subject: `${p.credits.toLocaleString()} credits added`, body: <Layout preview="Credits added" title="Credits added"><Text>{p.credits.toLocaleString()} credits are ready to use.</Text></Layout> }),
  buildDone: (p: { project: string; link: string }) => ({ subject: "Your project is ready", body: <Layout preview="Build finished" title={`${p.project} is ready`} cta={{ label: "Open project", href: p.link }}><Text>The build finished while you were away. Open it to see the preview.</Text></Layout> }),
  deployDone: (p: { url: string }) => ({ subject: `Your site is live at ${p.url}`, body: <Layout preview="Deployed" title="Your site is live" cta={{ label: "Open site", href: `https://${p.url}` }}><Text>SSL is active and all pages passed the smoke test.</Text></Layout> }),
  deployFailed: (p: { reason: string; link: string }) => ({ subject: "Deploy stopped, here is why", body: <Layout preview="Deploy failed" title="Deploy stopped" cta={{ label: "See the log", href: p.link }}><Text>{p.reason}</Text></Layout> }),
  teamInvite: (p: { by: string; workspace: string; link: string }) => ({ subject: `${p.by} invited you to ${p.workspace}`, body: <Layout preview="Team invite" title="You're invited" cta={{ label: "Accept invite", href: p.link }}><Text>{p.by} invited you to the {p.workspace} workspace on Purpio.</Text></Layout> }),
  referralReward: (p: { credits: number }) => ({ subject: `You earned ${p.credits} credits`, body: <Layout preview="Referral reward" title="Referral reward"><Text>A friend you invited bought a plan. {p.credits} credits were added to your account.</Text></Layout> }),
  dataExport: (p: { link: string }) => ({ subject: "Your data is ready to download", body: <Layout preview="Data export" title="Your data is ready" cta={{ label: "Download", href: p.link }}><Text>The link works for 7 days.</Text></Layout> }),
  accountDeleted: () => ({ subject: "Your account was deleted", body: <Layout preview="Account deleted" title="Account deleted"><Text>Your Purpio account and its data were deleted as requested.</Text></Layout> }),
};
export type TemplateKey = keyof typeof templates;

const resend = () => new Resend(process.env.RESEND_API_KEY);
export async function sendEmail<K extends TemplateKey>(to: string, key: K, params: Parameters<(typeof templates)[K]>[0]) {
  const t = (templates[key] as (p: unknown) => { subject: string; body: React.ReactElement })(params);
  const html = await render(t.body);
  const text = await render(t.body, { plainText: true });
  const res = await resend().emails.send({ from: process.env.EMAIL_FROM ?? "Purpio <hello@purpio.com>", to, subject: t.subject, html, text });
  return { subject: t.subject, providerId: res.data?.id ?? null, error: res.error?.message ?? null };
}
