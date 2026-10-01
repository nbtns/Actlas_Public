import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifyToken } from "@/lib/auth";
import { sendDeviceTestNotification } from "@/lib/notifications";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const user = await verifyToken(token);
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "INVALID_ENDPOINT" }, { status: 400 });

  const result = await sendDeviceTestNotification(user.userId, endpoint);
  if (result.status === "not_registered") {
    return NextResponse.json({ error: "DEVICE_NOT_REGISTERED" }, { status: 410 });
  }
  if (result.status === "disabled") {
    return NextResponse.json({ error: "PUSH_DISABLED" }, { status: 409 });
  }
  if (result.status === "not_configured") {
    return NextResponse.json({ error: "PUSH_NOT_CONFIGURED" }, { status: 503 });
  }
  if (result.status === "failed") {
    return NextResponse.json({ error: "PUSH_DELIVERY_FAILED" }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
