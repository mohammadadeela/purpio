import { NextResponse, type NextRequest } from "next/server";
const PUBLIC = ["/login", "/pricing", "/r/", "/invite/", "/_next", "/icon", "/favicon", "/site.webmanifest", "/api"];
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p)) || pathname === "/") return NextResponse.next();
  if (!req.cookies.get("purpio_session")) { const url = new URL("/login", req.url); url.searchParams.set("next", pathname); return NextResponse.redirect(url); }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
