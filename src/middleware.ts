import { NextResponse, type NextRequest } from "next/server";

// Plain redirect when there is no session cookie; actual validity is checked by requireUser().
export function middleware(req: NextRequest) {
  if (!req.cookies.has("foyra_session")) return NextResponse.redirect(new URL("/login", req.url));
}

// Excludes "/" (which picks /setup or /login), /login, /setup, static files (incl. the installable app's manifest and icons) and /api/ (routes check their own token).
export const config = { matcher: ["/((?!_next/|api/|favicon.ico|manifest.webmanifest|icon0.svg|icon1.png|apple-icon.png|login|setup).+)"] };
