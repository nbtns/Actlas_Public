import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeOAuthClientId } from "@/lib/stripe";

export const runtime = "nodejs";

export const STRIPE_OAUTH_STATE_COOKIE = "stripe_oauth_state";

function getBaseUrl(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || request.nextUrl.origin;
}

function buildSettingsUrl(request: NextRequest, status: string) {
  const url = new URL("/", getBaseUrl(request));
  url.searchParams.set("view", "teacher-settings");
  url.searchParams.set("stripe", status);
  return url;
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  if (!token) {
    return NextResponse.redirect(buildSettingsUrl(request, "auth_required"));
  }

  const payload = await verifyToken(token);
  if (!payload || payload.role !== "TEACHER") {
    return NextResponse.redirect(buildSettingsUrl(request, "auth_required"));
  }

  const teacher = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { email: true, name: true },
  });
  if (!teacher) {
    return NextResponse.redirect(buildSettingsUrl(request, "auth_required"));
  }

  let clientId: string;
  try {
    clientId = getStripeOAuthClientId();
  } catch (error) {
    console.error("Stripe OAuth client ID is missing:", error);
    return NextResponse.redirect(buildSettingsUrl(request, "not_configured"));
  }

  const baseUrl = getBaseUrl(request);
  const redirectUri = new URL("/api/stripe/oauth/callback", baseUrl).toString();
  const publicProfileUrl = new URL("/profile", baseUrl).toString();
  const state = randomBytes(24).toString("hex");
  const authorizeUrl = new URL("https://connect.stripe.com/oauth/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("scope", "read_write");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("stripe_user[email]", teacher.email);
  authorizeUrl.searchParams.set("stripe_user[url]", publicProfileUrl);
  authorizeUrl.searchParams.set("stripe_user[country]", "JP");
  authorizeUrl.searchParams.set("stripe_user[product_description]", `${teacher.name} online lessons via Actlas`);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STRIPE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/",
  });
  return response;
}
