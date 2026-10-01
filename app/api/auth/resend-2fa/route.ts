import { randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TWO_FACTOR_COOKIE, verifyScopedToken } from "@/lib/auth";
import { send2FACode } from "@/lib/mail";

const TWO_FACTOR_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_2FA_RESENDS = 5;

function generate2FACode() {
  return randomInt(100000, 1000000).toString();
}

export async function POST(request: NextRequest) {
  try {
    const pendingCookie = request.cookies.get(TWO_FACTOR_COOKIE)?.value;
    const pending = pendingCookie
      ? await verifyScopedToken(pendingCookie, "2fa")
      : null;

    if (!pending) {
      return NextResponse.json(
        { error: "認証の有効期限が切れました。もう一度ログインしてください。" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: pending.userId },
      select: {
        id: true,
        email: true,
        role: true,
        sessionVersion: true,
        lockedUntil: true,
        twoFactorResendCount: true,
        twoFactorLastSentAt: true,
      },
    });

    if (
      !user ||
      user.role !== "TEACHER" ||
      user.sessionVersion !== pending.sessionVersion
    ) {
      const response = NextResponse.json(
        { error: "認証の有効期限が切れました。もう一度ログインしてください。" },
        { status: 401 }
      );
      response.cookies.delete(TWO_FACTOR_COOKIE);
      return response;
    }

    if (user.lockedUntil && new Date() < user.lockedUntil) {
      const response = NextResponse.json(
        { error: "アカウントがロックされています。しばらく時間をおいてから再試行してください。" },
        { status: 403 }
      );
      response.cookies.delete(TWO_FACTOR_COOKIE);
      return response;
    }

    const now = Date.now();
    const lastSentAt = user.twoFactorLastSentAt?.getTime() ?? 0;
    const waitMs = TWO_FACTOR_RESEND_COOLDOWN_MS - (now - lastSentAt);
    if (waitMs > 0) {
      return NextResponse.json(
        { error: `認証コードの再送信は${Math.ceil(waitMs / 1000)}秒後にもう一度お試しください。` },
        { status: 429 }
      );
    }

    if (user.twoFactorResendCount >= MAX_2FA_RESENDS) {
      const response = NextResponse.json(
        { error: "認証コードの再送信回数が上限に達しました。もう一度ログインしてください。" },
        { status: 429 }
      );
      response.cookies.delete(TWO_FACTOR_COOKIE);
      return response;
    }

    const code = generate2FACode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorCode: code,
        twoFactorExpiresAt: expiresAt,
        twoFactorFailedAttempts: 0,
        twoFactorResendCount: { increment: 1 },
        twoFactorLastSentAt: new Date(now),
      },
    });

    try {
      await send2FACode(user.email, code);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "認証メールの送信に失敗しました。管理者に連絡してください。";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Resend 2FA error:", error);
    return NextResponse.json(
      { error: "コードの再送信中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
