import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exchangeStripeOAuthCode } from "@/lib/stripe";

export const runtime = "nodejs";

const STRIPE_OAUTH_STATE_COOKIE = "stripe_oauth_state";

function getBaseUrl(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || request.nextUrl.origin;
}

function buildSettingsUrl(request: NextRequest, status: string, connectedAccountId?: string) {
  const url = new URL("/", getBaseUrl(request));
  url.searchParams.set("view", "teacher-settings");
  url.searchParams.set("stripe", status);
  if (connectedAccountId) url.searchParams.set("stripeAccount", connectedAccountId);
  return url;
}

async function createUniqueUsername() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const username = Math.floor(10000 + Math.random() * 90000).toString();
    const existing = await prisma.teacherProfile.findUnique({ where: { username } });
    if (!existing) return username;
  }
  throw new Error("Could not generate a unique teacher profile username.");
}

export async function GET(request: NextRequest) {
  const responseError = request.nextUrl.searchParams.get("error");
  if (responseError) {
    const response = NextResponse.redirect(buildSettingsUrl(request, "connect_cancelled"));
    response.cookies.delete(STRIPE_OAUTH_STATE_COOKIE);
    return response;
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(STRIPE_OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    const response = NextResponse.redirect(buildSettingsUrl(request, "connect_error"));
    response.cookies.delete(STRIPE_OAUTH_STATE_COOKIE);
    return response;
  }

  const token = request.cookies.get("token")?.value;
  if (!token) {
    const response = NextResponse.redirect(buildSettingsUrl(request, "auth_required"));
    response.cookies.delete(STRIPE_OAUTH_STATE_COOKIE);
    return response;
  }

  const payload = await verifyToken(token);
  if (!payload || payload.role !== "TEACHER") {
    const response = NextResponse.redirect(buildSettingsUrl(request, "auth_required"));
    response.cookies.delete(STRIPE_OAUTH_STATE_COOKIE);
    return response;
  }

  try {
    const stripeConnection = await exchangeStripeOAuthCode(code);
    const existingProfile = await prisma.teacherProfile.findUnique({
      where: { userId: payload.userId },
      select: { id: true },
    });

    if (existingProfile) {
      await prisma.teacherProfile.update({
        where: { userId: payload.userId },
        data: {
          stripeConnectedAccountId: stripeConnection.stripe_user_id,
          stripeConnectedLivemode: stripeConnection.livemode ?? null,
          stripeConnectedAt: new Date(),
        },
      });
    } else {
      await prisma.teacherProfile.create({
        data: {
          userId: payload.userId,
          username: await createUniqueUsername(),
          stripeConnectedAccountId: stripeConnection.stripe_user_id,
          stripeConnectedLivemode: stripeConnection.livemode ?? null,
          stripeConnectedAt: new Date(),
        },
      });
    }

    const response = NextResponse.redirect(
      buildSettingsUrl(request, "connected", stripeConnection.stripe_user_id)
    );
    response.cookies.delete(STRIPE_OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    console.error("Stripe OAuth callback failed:", error);
    const response = NextResponse.redirect(buildSettingsUrl(request, "connect_error"));
    response.cookies.delete(STRIPE_OAUTH_STATE_COOKIE);
    return response;
  }
}
