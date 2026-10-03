/**
 * Purpio background master prompts.
 * Four stages run on every build. Versioned here; admin can override via PromptVersion rows.
 * None of this text is ever shown to the user.
 */
export const PROMPT_VERSION = { intent: 14, design: 22, build: 31, review: 9, media: 4 };

export const GENERIC_TELLS = `Never produce these generic tells:
- cream background with terracotta accent; near-black with a single acid-green or vermilion accent; purple-on-white SaaS unless the brief asks
- the SaaS card kit: identical rounded cards, one radius everywhere, the same grey shadow under each, gradient washes as decoration
- tracked-out ALL-CAPS eyebrow labels above headings; meta strings joined with middle dots; "WORD — fragment" labels; a "→" appended to links
- "headline over a gradient with three stats" as the hero; accenting one word of a headline in another color
- lorem ipsum, "welcome to our website", "AI-powered", "coming soon", TODO`;

export const INTENT_PROMPT = (userPrompt: string, projectType: string, locale: string) => `You turn one sentence from a non-technical person into a complete product brief. Output JSON only, no prose, no code fences.

Input: "${userPrompt}"
Requested type: ${projectType}
User language: ${locale}

Return exactly this shape:
{
 "name": short brand-ready name taken from the request,
 "subject": what the business or project is,
 "audience": who uses it and on which device first,
 "primary_goal": the one action the site or app must get people to do,
 "pages": every page a finished product of this kind needs (never fewer than: home, about, services or products, pricing, contact with a working form, blog, privacy, terms, cookies, 404; web and mobile apps add auth, onboarding, dashboard, settings, billing, notifications, admin),
 "data": { entity: [key fields] } for everything to store,
 "integrations": { payments, booking, whatsapp, maps, email, sms, analytics: true|false } chosen as a successful business of this kind would,
 "admin": every admin screen the owner needs to run this without a developer (content pages, hero slider, products or services, orders or bookings, customers, media library, SEO per page, theme, announcement bar, analytics, team),
 "tone": three adjectives for the brand voice,
 "style_refs": three well-known products whose feel fits, each with one line on why,
 "assumptions": every gap you filled, in plain words a customer understands
}
Rules: never leave a field empty; prefer the choice a successful business of this kind would make; names and copy in the user's language.`;

export const DESIGN_PROMPT = (brief: string, seed: string) => `You are the design lead at a studio known for giving every client a look that cannot be mistaken for anyone else's. Produce the design system for this brief before any code exists. Output two fenced blocks: \`\`\`json tokens.json\`\`\` and \`\`\`md design.md\`\`\`.

Brief: ${brief}
Style seed: ${seed}  (use it to pick among equally valid options so two users with the same brief never get the same result)

tokens.json must define:
- palette: canvas, surface, ink, ink2, accent, accent2, success, warning, danger; and a dark set. The accent comes from the subject matter: a bakery is not purple, a law firm is not neon.
- typography: one display face and one text face from Google Fonts chosen for this subject (not Inter + Playfair as a default), a 7-step scale 12 to 64, line heights, letter spacing for display sizes.
- radius: 3 steps tied to hierarchy (inputs, cards, sheets); shadow: one hairline shadow and one accent-tinted hover shadow; spacing: 4-based scale.
- motion: press 120 ms, page 200 ms, reveal 400 ms, easing cubic-bezier(.2,.8,.2,1); the one orchestrated page-load moment.
- image_direction: subject, lighting, lens, color notes, so generated images match the palette.

design.md must describe:
- Hero concept: one specific idea (a live counter, a product assembling itself on scroll, full-bleed video with a short claim, an oversized case study).
- Signature element: the single memorable thing (cursor-reactive 3D object, marquee of real products, split-screen reveal). Everything else stays quiet.
- Button system: primary with gradient sheen on hover, 0.98 scale on press, ripple from the click point, spinner inside the button while loading, success tick; secondary and ghost styles.
- Micro-interactions: card lift on hover, scroll-aware shrinking header, 30 ms staggered first-load entrance, skeleton loaders, animated numbers, toasts named after the action.
- 3D or motion piece where it earns its place, with a static fallback for low-power devices and prefers-reduced-motion.
- Copy voice: sentence case, verbs on buttons, real-sounding business content.

${GENERIC_TELLS}`;

export const BUILD_CHECKLIST = [
  "Every page in the brief exists with real content and navigation; no placeholder, TODO, coming soon or lorem ipsum anywhere.",
  "Admin area at /admin with login, dashboard charts from seeded data, and a management screen for every entity including hero slider, media library, SEO per page, theme and announcement bar; every list has search, filter, sort, pagination, empty state and bulk actions.",
  "Forms: correct autocomplete attribute on every field, inline validation, server validation with zod, success and error states; the contact form emails the owner.",
  "Buttons and interactions exactly as design.md: press scale, hover sheen, ripple, in-button spinner, disabled state; card lift; shrinking header; page transitions; staggered first load; animated numbers; toasts named after the action.",
  "Hero and signature element implemented as described, with reduced-motion and low-power fallbacks.",
  "Dark mode via tokens with a toggle persisted per visitor; both modes meet 4.5:1 contrast.",
  "Responsive from 360 px to 1440 px; no horizontal scroll; 44 px touch targets; tables scroll inside their container.",
  "Accessibility: visible focus rings in the accent color, labelled icons, skip link, keyboard-reachable menus, live region for async results.",
  "Performance: next/image everywhere, fonts with display swap, zero layout shift, route-level code splitting.",
  "SEO: title and description per page, Open Graph image, canonical, sitemap.xml, robots.txt, JSON-LD for the business type.",
  "Data: Prisma schema for every entity, migrations, seed with 20+ realistic rows per entity in the brief's language, optimistic UI, cached reads.",
  "Trust: cookie consent banner, privacy, terms and cookies pages, contact details in the footer, social proof section ready for real logos.",
  "States: loading skeletons, empty states with a next action, error boundaries with retry, branded 404 and 500.",
  "Integrations from the brief wired through environment variables, never literals: payments, WhatsApp, booking, maps, SMS, email.",
  "Delivery: README (run, seed, deploy), .env.example with comments, GitHub Actions for lint, typecheck and build; one command to start.",
];

export const BUILD_PROMPT = (p: { brief: string; tokens: string; design: string; projectType: string; existingFiles?: string; instruction?: string; selector?: string }) => `You are a senior full-stack engineer and front-end craftsperson. ${p.existingFiles ? "Modify the existing project in place: change only what the instruction needs and return only the files that change, each complete." : `Build the complete, production-ready ${p.projectType} from the brief and the design system. Write every file in full.`} Do not ask questions; follow the brief's assumptions.

Brief: ${p.brief}
Design tokens: ${p.tokens}
Design notes: ${p.design}
${p.existingFiles ? `Existing files:\n${p.existingFiles}\n` : ""}${p.instruction ? `Instruction from the user: "${p.instruction}"${p.selector ? ` (they clicked the element ${p.selector} in the preview)` : ""}\n` : ""}
Stack: Next.js 15 App Router, TypeScript strict, Tailwind with the tokens as CSS variables, Framer Motion, React Three Fiber only where design.md asks, Prisma (SQLite in preview, Postgres in production), NextAuth, Resend, zod, next/image. Mobile apps: Expo with expo-router and NativeWind, same tokens, app icon and splash included.

Hard requirements, every one checked before you finish:
${BUILD_CHECKLIST.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Style rules: colors, radius, shadow and motion only from tokens; one typeface pair; numbered markers only for real sequences; no all-caps labels; no eyebrow text above every heading.
${GENERIC_TELLS}

Output format: for each file write a line "=== FILE: path ===" followed by the complete file content, then "=== END ===". Finish with "=== FILE: CHANGES.md ===" summarising what was built and the brief's assumptions in words a customer understands.`;

export const REVIEW_PROMPT = (checklist: string[], buildLog: string, files: string) => `You are the release reviewer. Below is the generated project and the build output. Audit it against every requirement and against every page at 360 px and 1280 px in light and dark mode.

Requirements:
${checklist.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Build output:
${buildLog}

Files:
${files}

For each requirement return pass or fail with file and line. For every fail, return the corrected file in full using "=== FILE: path ===" blocks. Also fix: text that reads as generated, missing alt text, broken links, unused imports, console errors, missing empty states, missing autocomplete attributes, hard-coded hex colors outside tokens, animations without a reduced-motion guard.
End with "=== SUMMARY ===" and one paragraph in customer-facing language describing what the project now contains (pages, admin, features), nothing about models or prompts.`;

export const MEDIA_PROMPT = (p: { name: string; subject: string; imageDirection: string; palette: string; tone: string; userPrompt: string; video?: { durationS: number; aspect: string } }) =>
  `Create ${p.video ? "a video" : "an image"} for the project "${p.name}" (${p.subject}). Art direction: ${p.imageDirection}. Palette to match: ${p.palette}. Mood: ${p.tone}. Request: "${p.userPrompt}". No text, no logos, no watermarks, no recognisable faces unless asked. Photographic realism unless the design system is illustrated. Leave clear space where a headline will sit.${p.video ? ` ${p.video.durationS} seconds, ${p.video.aspect}, slow camera movement, loopable, no burned-in text.` : ""}`;

/** Parses "=== FILE: path ===" blocks from a build response. */
export function parseFiles(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const re = /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END ===/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ path: m[1].trim(), content: m[2] });
  return out;
}
export function styleSeed(projectId: string): string {
  let h = 0; for (const ch of projectId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}
