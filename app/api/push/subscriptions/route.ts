import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifyToken } from "@/lib/auth";
import {
  revokePushSubscription,
  savePushSubscription,
} from "@/lib/notifications";

type IncomingSubscription = {
  endpoint?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
};

function readSubscription(value: unknown) {
  const subscription = value as IncomingSubscription | undefined;
  const endpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint : "";
  const p256dh = typeof subscription?.keys?.p256dh === "string" ? subscription.keys.p256dh : "";
  const auth = typeof subscription?.keys?.auth === "string" ? subscription.keys.auth : "";

  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

async function requireUser(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const subscription = readSubscription(body.subscription ?? body);
  if (!subscription) return NextResponse.json({ error: "INVALID_SUBSCRIPTION" }, { status: 400 });

  await savePushSubscription({
    userId: user.userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "INVALID_ENDPOINT" }, { status: 400 });

  await revokePushSubscription(endpoint, user.userId);
  return NextResponse.json({ success: true });
}
