import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/overview",
  "/inbox",
  "/campaigns",
  "/automations",
  "/contacts",
  "/logs",
  "/settings",
  "/diagnostics",
];

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (isProtected && !hasSessionCookie(request)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // A cookie may be stale. Let the dashboard layout validate the session;
  // redirecting login based on cookie presence alone creates a redirect loop.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/overview/:path*",
    "/inbox/:path*",
    "/campaigns/:path*",
    "/automations/:path*",
    "/contacts/:path*",
    "/logs/:path*",
    "/settings/:path*",
    "/diagnostics/:path*",
  ],
};
