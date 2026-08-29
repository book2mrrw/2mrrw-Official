import { NextResponse } from "next/server";
import { updateSession } from "./src/lib/supabase/middleware";
import {
  loginRedirectPath,
  resolveRouteAccessDecision,
  routeRequiresVerifiedPrincipal,
} from "./src/lib/auth/route-access-policy";

function copyResponseCookies(source, target) {
  for (const cookie of source?.cookies?.getAll?.() || []) {
    target.cookies.set(cookie);
  }
  return target;
}

function markProtectedResponse(response) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export async function middleware(request) {
  const pathname = request.nextUrl.pathname;
  const method = request.method || "GET";
  const initialDecision = resolveRouteAccessDecision({ pathname, method });

  // Token, webhook, cron, capability, health, and static routes authenticate
  // inside their own explicit boundary and do not need a consumer lookup here.
  if (!routeRequiresVerifiedPrincipal(initialDecision.accessClass)) {
    return NextResponse.next();
  }

  let session;
  try {
    session = await updateSession(request);
  } catch {
    session = { response: NextResponse.next({ request }), user: null };
  }

  const decision = resolveRouteAccessDecision({
    pathname,
    method,
    hasVerifiedPrincipal: Boolean(session.user),
  });

  if (decision.allowed) {
    return markProtectedResponse(session.response);
  }

  if (decision.responseKind === "api_401") {
    const denied = NextResponse.json(
      { error: "Authentication required", code: "CONSUMER_AUTH_REQUIRED" },
      { status: 401 }
    );
    return copyResponseCookies(session.response, markProtectedResponse(denied));
  }

  const returnTo = `${pathname}${request.nextUrl.search || ""}`;
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = new URL(loginRedirectPath(returnTo), request.url).search;
  const denied = NextResponse.redirect(loginUrl, 307);
  return copyResponseCookies(session.response, markProtectedResponse(denied));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image).*)",
  ],
};
