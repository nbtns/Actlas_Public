import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, EMAIL_CHANGE_COOKIE, TWO_FACTOR_COOKIE, verifyToken } from "@/lib/auth";
import { revokePushSubscription } from "@/lib/notifications";

/**
 * ログアウトAPI
 * JWTトークンのcookieを削除してログアウトする
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const pushEndpoint = typeof body.pushEndpoint === "string" ? body.pushEndpoint : "";
  const token = request.cookies.get(AUTH_COOKIE)?.value;

  if (pushEndpoint && token) {
    const user = await verifyToken(token);
    if (user) {
      await revokePushSubscription(pushEndpoint, user.userId);
    }
  }

  const response = NextResponse.json({ success: true });

  // クッキーを削除（期限を過去にする）
  response.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  response.cookies.delete(TWO_FACTOR_COOKIE);
  response.cookies.delete(EMAIL_CHANGE_COOKIE);

  return response;
}
