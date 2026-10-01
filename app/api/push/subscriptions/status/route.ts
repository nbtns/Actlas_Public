import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifyToken } from "@/lib/auth";
import { hasActivePushSubscription } from "@/lib/notifications";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const user = await verifyToken(token);
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "INVALID_ENDPOINT" }, { status: 400 });

  const subscribed = await hasActivePushSubscription(endpoint, user.userId);
  return NextResponse.json({ subscribed });
}
