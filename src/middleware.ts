import { NextResponse, type NextRequest } from "next/server";

// Simple redirection si aucun cookie de session ; la validité réelle est vérifiée par requireUser().
export function middleware(req: NextRequest) {
  if (!req.cookies.has("foyra_session")) return NextResponse.redirect(new URL("/login", req.url));
}

// Exclut « / » (qui choisit entre /setup et /login), /login, /setup et les fichiers statiques.
export const config = { matcher: ["/((?!_next/|favicon.ico|login|setup).+)"] };
