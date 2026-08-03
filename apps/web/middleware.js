import { NextResponse } from "next/server";
import { updateSession } from "./src/lib/supabase/middleware";

const STRIPE_WEBHOOK_PATHS = new Set([
  "/api/webhook",
  "/api/webhooks/stripe",
  "/api/stripe/webhook",
]);

export async function middleware(request) {
  if (STRIPE_WEBHOOK_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/public/.*|api/health.*|api/guest/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|wav|mp3)$).*)",
  ],
};
