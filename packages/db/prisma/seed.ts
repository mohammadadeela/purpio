import { PrismaClient, ProjectType } from "@prisma/client";
const db = new PrismaClient();

// 1 credit = $0.01 to the user. credits = cost × markup / 0.01
const c = (usd: number, markup = 2) => Math.round(usd * markup * 100);
const models = [
  { key: "gpt-5", provider: "openai", label: "GPT-5", badge: "Default", description: "Best all-round code and planning", costPer1kIn: 0.00125, costPer1kOut: 0.01, isDefault: true, sort: 1 },
  { key: "gpt-5-mini", provider: "openai", label: "GPT-5 mini", badge: "Fastest", description: "Fast edits, chat, idea cards", costPer1kIn: 0.00025, costPer1kOut: 0.002, sort: 2 },
  { key: "claude-sonnet-4-6", provider: "anthropic", label: "Claude Sonnet 4.6", badge: "Best quality", description: "Premium code quality and large refactors", costPer1kIn: 0.003, costPer1kOut: 0.015, minPlan: "pro", sort: 3 },
  { key: "gemini-2.5-flash", provider: "google", label: "Gemini 2.5 Flash", description: "Copy, data entry, summaries", costPer1kIn: 0.0003, costPer1kOut: 0.0025, sort: 4 },
  { key: "gemini-image", provider: "google", label: "Gemini Image", description: "Hero images, products, logos", costPerImage: 0.04, sort: 5 },
  { key: "gemini-video", provider: "google", label: "Gemini Video", description: "Promo and background video", costPerVideoS: 0.4, sort: 6 },
];
const plans = [
  { key: "free", name: "Free", priceCents: 0, creditsPerPeriod: 150, maxProjects: 2, maxTeamMembers: 1, features: ["Purpio subdomain", "Watermark on media"], sort: 0 },
  { key: "starter", name: "Starter", priceCents: 1900, creditsPerPeriod: 1500, maxProjects: 10, maxTeamMembers: 1, features: ["Source download", "No watermark"], sort: 1 },
  { key: "pro", name: "Pro", priceCents: 4900, creditsPerPeriod: 4500, maxProjects: null, maxTeamMembers: 3, features: ["Hostinger deploy", "Custom domain", "Claude Sonnet", "Priority queue"], sort: 2 },
  { key: "studio", name: "Studio", priceCents: 12900, creditsPerPeriod: 14000, maxProjects: null, maxTeamMembers: 10, features: ["Video up to 60 s", "White-label previews", "API access", "Dedicated support"], sort: 3 },
];
const packs = [
  { key: "p800", name: "800 credits", credits: 800, priceCents: 1000, bonusPct: 0, sort: 0 },
  { key: "p2200", name: "2,200 credits", credits: 2200, priceCents: 2500, bonusPct: 10, sort: 1 },
  { key: "p4800", name: "4,800 credits", credits: 4800, priceCents: 5000, bonusPct: 20, sort: 2 },
  { key: "p10000", name: "10,000 credits", credits: 10000, priceCents: 10000, bonusPct: 25, sort: 3 },
];
const ideas: [string, string, string, string, number][] = [
  ["whatsapp", "WhatsApp inbox", "Floating chat button and a WhatsApp Business inbox in your admin.", "chat", 40],
  ["sms", "SMS login & alerts", "Phone sign-in and order or booking texts.", "phone", 50],
  ["data-entry", "AI data entry", "Upload a spreadsheet or photos; products and contacts fill themselves.", "table", 60],
  ["support-chat", "AI support chat", "Trained on your own pages, hands off to email.", "bot", 80],
  ["promo-video", "Promo video", "A 15-second video of your site with captions and music.", "video", 1200],
  ["screenshots", "Screenshot pack", "Device-framed shots of every page and the admin.", "camera", 30],
  ["slider", "Hero slider manager", "Admin page for slides with auto-generated images.", "slides", 35],
  ["booking", "Booking calendar", "Slots, reminders and Google Calendar sync.", "cal", 70],
  ["payments", "Online payments", "Stripe or PayPal checkout wired into the project.", "card", 90],
  ["i18n", "Multi-language", "Translate every page, add a switcher, RTL ready.", "globe", 60],
  ["blog", "Blog with AI writer", "CMS, SEO fields and a draft generator.", "pen", 60],
  ["analytics", "Analytics dashboard", "GA4 plus an in-admin visitor chart.", "chart", 30],
  ["loyalty", "Loyalty & coupons", "Points, referral codes, discount rules.", "tag", 60],
  ["3d", "3D product viewer", "Spin products, hotspots, AR on phones.", "cube", 100],
  ["brand-kit", "App icon & brand kit", "Logo variations, favicons, social banners.", "brand", 40],
  ["emails", "Email sequences", "Welcome, abandoned cart, re-engagement.", "mail", 50],
  ["deck", "Pitch deck", "10 slides about the project with real screenshots.", "deck", 80],
  ["themes", "Dark mode & themes", "Toggle plus three saved themes in admin.", "moon", 20],
  ["reviews", "Reviews & ratings", "Collect, moderate, show with schema markup.", "star", 40],
  ["membership", "Membership & paywall", "Plans, gated content and a member area.", "lock", 90],
];
const templates: [string, string, ProjectType, string][] = [
  ["restaurant", "Restaurant with online orders", "website", "A restaurant website with menu, online ordering, table booking and an admin to manage dishes"],
  ["saas", "SaaS landing + waitlist", "website", "A SaaS landing page with features, pricing, waitlist form and a blog"],
  ["clinic", "Clinic booking app", "webapp", "A clinic web app with doctors, appointment booking, patient accounts and an admin"],
  ["store", "E-commerce store + admin", "webapp", "An online store with products, cart, checkout, order tracking and a full admin"],
  ["fitness", "Fitness mobile app", "mobile", "A fitness mobile app with workouts, progress tracking and reminders"],
  ["realestate", "Real-estate listings", "website", "A real-estate site with listings, filters, map, agent pages and an admin"],
  ["portfolio", "Creator portfolio", "website", "A personal portfolio with case studies, about page and contact form"],
  ["delivery", "Delivery dashboard", "webapp", "A delivery business dashboard with orders, drivers on a map and daily revenue"],
];

async function main() {
  for (const m of models) {
    const markup = 2;
    await db.model.upsert({ where: { key: m.key }, update: {}, create: {
      ...m, markup,
      creditsPer1kIn: (m.costPer1kIn ?? 0) * markup * 100, creditsPer1kOut: (m.costPer1kOut ?? 0) * markup * 100,
      creditsPerImage: c(m.costPerImage ?? 0), creditsPerVideoS: c(m.costPerVideoS ?? 0),
    } });
  }
  for (const p of plans) await db.plan.upsert({ where: { key: p.key }, update: {}, create: p });
  for (const p of packs) await db.creditPack.upsert({ where: { key: p.key }, update: {}, create: p });
  for (const [key, title, description, icon, creditEstimate] of ideas)
    await db.ideaCard.upsert({ where: { key }, update: {}, create: { key, title, description, icon, category: "growth", creditEstimate, promptTemplate: `Add "${title}" to the current project: ${description} Include the pages, admin screens, data model and settings a real business needs for this.` } });
  for (const [key, name, type, promptSeed] of templates) await db.template.upsert({ where: { key }, update: {}, create: { key, name, type, promptSeed, featured: true } });
  await db.coupon.upsert({ where: { code: "LAUNCH30" }, update: {}, create: { code: "LAUNCH30", pctOff: 30, maxUses: 1000 } });
  console.log("Seeded models, plans, packs, idea cards, templates.");
}
main().finally(() => db.$disconnect());
