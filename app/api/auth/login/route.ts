import { randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AUTH_COOKIE,
  TWO_FACTOR_COOKIE,
  signScopedToken,
  signToken,
  verifyPassword,
} from "@/lib/auth";
import { send2FACode } from "@/lib/mail";
import { PUBLIC_DEMO } from "@/lib/public-demo";
import { assertDemoDatabaseUrl } from "@/scripts/demo-environment.mjs";

const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const TWO_FACTOR_COOKIE_MAX_AGE = 60 * 15;

function generate2FACode() {
  return randomInt(100000, 1000000).toString();
}

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
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "ログイン方法を選んでください" }, { status: 400 });
    }

    let { email, password } = body;
    let demoAccount: { id: string; role: "TEACHER" | "STUDENT" } | null = null;

    // デモでは固定の架空アカウントだけを選べる。秘密値はブラウザに渡さない。
    if ("demoRole" in body) {
      if (!PUBLIC_DEMO) {
        return NextResponse.json({ error: "デモログインは利用できません" }, { status: 404 });
      }
      if (body.demoRole !== "TEACHER" && body.demoRole !== "STUDENT") {
        return NextResponse.json({ error: "先生または生徒を選んでください" }, { status: 400 });
      }
      assertDemoDatabaseUrl();
      const isTeacher = body.demoRole === "TEACHER";
      email = isTeacher ? "teacher@example.com" : "student1@example.com";
      demoAccount = { id: isTeacher ? "demo-teacher" : "demo-student-1", role: body.demoRole };
      password = process.env.DEMO_ACCOUNT_PASSWORD;
      if (!password || password.length < 16) {
        return NextResponse.json(
          { error: "デモの初期設定が必要です。npm run demo:setup と npm run db:setup を実行してください" },
          { status: 503 }
        );
      }
    }

    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!normalizedEmail || !password) {
      return NextResponse.json(
        { error: "メールアドレスとパスワードを入力してください" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || (demoAccount && (user.id !== demoAccount.id || user.role !== demoAccount.role))) {
      return NextResponse.json(
        { error: "メールアドレスまたはパスワードが正しくありません" },
        { status: 401 }
      );
    }

    if (user.lockedUntil && new Date() < user.lockedUntil) {
      return NextResponse.json(
        { error: "アカウントがロックされています。しばらく時間をおいてから再試行してください" },
        { status: 403 }
      );
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      const failedAttempts = user.failedLoginAttempts + 1;
      const lockedUntil =
        failedAttempts >= 10 ? new Date(Date.now() + 30 * 60 * 1000) : null;

      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: failedAttempts, lockedUntil },
      });

      return NextResponse.json(
        { error: "メールアドレスまたはパスワードが正しくありません" },
        { status: 401 }
      );
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    if (user.role === "TEACHER" && !PUBLIC_DEMO) {
      const code = generate2FACode();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const sentAt = new Date();

      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorCode: code,
          twoFactorExpiresAt: expiresAt,
          twoFactorFailedAttempts: 0,
          twoFactorResendCount: 0,
          twoFactorLastSentAt: sentAt,
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

      const pendingToken = await signScopedToken(
        {
          purpose: "2fa",
          userId: user.id,
          sessionVersion: user.sessionVersion,
        },
        "15m"
      );

      const response = NextResponse.json({ requires2FA: true });
      response.cookies.set(TWO_FACTOR_COOKIE, pendingToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: TWO_FACTOR_COOKIE_MAX_AGE,
        path: "/",
      });
      response.cookies.delete(AUTH_COOKIE);
      return response;
    }

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
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "ログイン処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
