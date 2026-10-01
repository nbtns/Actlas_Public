import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AUTH_COOKIE,
  TWO_FACTOR_COOKIE,
  signToken,
  verifyScopedToken,
} from "@/lib/auth";

const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const MAX_2FA_FAILED_ATTEMPTS = 5;
const TWO_FACTOR_LOCK_MS = 30 * 60 * 1000;

function setAuthCookie(response: NextResponse, token: string) {
  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: AUTH_COOKIE_MAX_AGE,
    path: "/",
  });
}

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code) {
      return NextResponse.json(
        { error: "認証コードを入力してください" },
        { status: 400 }
      );
    }

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

    if (user.twoFactorCode !== code) {
      const failedAttempts = user.twoFactorFailedAttempts + 1;

      if (failedAttempts >= MAX_2FA_FAILED_ATTEMPTS) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 10,
            lockedUntil: new Date(Date.now() + TWO_FACTOR_LOCK_MS),
            twoFactorCode: null,
            twoFactorExpiresAt: null,
            twoFactorFailedAttempts: failedAttempts,
          },
        });

        const response = NextResponse.json(
          { error: "認証コードの入力回数が上限に達しました。30分後にもう一度ログインしてください。" },
          { status: 429 }
        );
        response.cookies.delete(TWO_FACTOR_COOKIE);
        return response;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorFailedAttempts: failedAttempts },
      });

      return NextResponse.json(
        { error: "認証コードが正しくありません" },
        { status: 401 }
      );
    }

    if (!user.twoFactorExpiresAt || new Date() > user.twoFactorExpiresAt) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorCode: null,
          twoFactorExpiresAt: null,
          twoFactorFailedAttempts: 0,
        },
      });

      return NextResponse.json(
        { error: "認証コードの有効期限が切れています。再送信してください。" },
        { status: 401 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorCode: null,
        twoFactorExpiresAt: null,
        twoFactorFailedAttempts: 0,
        twoFactorResendCount: 0,
        twoFactorLastSentAt: null,
      },
    });

    const token = await signToken({
      userId: user.id,
      role: user.role as "TEACHER" | "STUDENT",
      sessionVersion: user.sessionVersion,
    });

    const response = NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    });

    setAuthCookie(response, token);
    response.cookies.delete(TWO_FACTOR_COOKIE);
    return response;
  } catch (error) {
    console.error("Verify 2FA error:", error);
    return NextResponse.json(
      { error: "認証処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
