import { randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  AUTH_COOKIE,
  EMAIL_CHANGE_COOKIE,
  hashPassword,
  signScopedToken,
  signToken,
  validatePasswordStrength,
  verifyPassword,
  verifyScopedToken,
  verifyToken,
} from "@/lib/auth";
import { sendEmailChangeCode } from "@/lib/mail";

const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const EMAIL_CHANGE_COOKIE_MAX_AGE = 60 * 15;

function generateConfirmationCode() {
  return randomInt(100000, 1000000).toString();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

function publicUser<T extends {
  avatarUrl: string | null;
  name: string;
  email: string;
  isFirstLogin: boolean;
  notificationsEnabled: boolean;
  language: string;
  timezone: string;
}>(user: T) {
  return {
    avatarUrl: user.avatarUrl,
    name: user.name,
    email: user.email,
    isFirstLogin: user.isFirstLogin,
    notificationsEnabled: user.notificationsEnabled,
    language: user.language,
    timezone: user.timezone,
  };
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(AUTH_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: "未認証" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "無効なトークン" }, { status: 401 });

    const body = await request.json();
    const {
      avatarUrl,
      name,
      birthDate,
      gender,
      isFirstLogin,
      notificationsEnabled,
      newEmail,
      emailChangeCode,
      currentPassword,
      newPassword,
      language,
      timezone,
    } = body;

    if (emailChangeCode !== undefined) {
      const pendingCookie = request.cookies.get(EMAIL_CHANGE_COOKIE)?.value;
      const pending = pendingCookie
        ? await verifyScopedToken(pendingCookie, "email-change")
        : null;

      if (
        !pending ||
        pending.userId !== payload.userId ||
        pending.sessionVersion !== payload.sessionVersion
      ) {
        const response = NextResponse.json(
          { error: "確認コードの有効期限が切れました。もう一度やり直してください。" },
          { status: 401 }
        );
        response.cookies.delete(EMAIL_CHANGE_COOKIE);
        return response;
      }

      if (pending.code !== String(emailChangeCode).trim()) {
        return NextResponse.json({ error: "確認コードが正しくありません" }, { status: 400 });
      }

      const existing = await prisma.user.findFirst({
        where: { email: pending.newEmail, id: { not: payload.userId } },
      });
      if (existing) {
        return NextResponse.json({ error: "このメールアドレスはすでに使用されています" }, { status: 400 });
      }

      const updatedUser = await prisma.user.update({
        where: { id: payload.userId },
        data: {
          email: pending.newEmail,
          sessionVersion: { increment: 1 },
        },
        select: {
          id: true,
          role: true,
          sessionVersion: true,
          avatarUrl: true,
          name: true,
          email: true,
          isFirstLogin: true,
          notificationsEnabled: true,
          language: true,
          timezone: true,
        },
      });

      const newToken = await signToken({
        userId: updatedUser.id,
        role: updatedUser.role as "TEACHER" | "STUDENT",
        sessionVersion: updatedUser.sessionVersion,
      });

      const response = NextResponse.json(publicUser(updatedUser));
      setAuthCookie(response, newToken);
      response.cookies.delete(EMAIL_CHANGE_COOKIE);
      return response;
    }

    if (newEmail !== undefined) {
      const trimmedEmail = String(newEmail).trim().toLowerCase();
      if (!trimmedEmail) {
        return NextResponse.json({ error: "メールアドレスを入力してください" }, { status: 400 });
      }
      if (!isValidEmail(trimmedEmail)) {
        return NextResponse.json({ error: "メールアドレスの形式を確認してください" }, { status: 400 });
      }
      if (!currentPassword) {
        return NextResponse.json({ error: "現在のパスワードを入力してください" }, { status: 400 });
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          email: true,
          password: true,
          sessionVersion: true,
        },
      });
      if (!user) {
        return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
      }
      if (trimmedEmail === user.email.toLowerCase()) {
        return NextResponse.json({ error: "現在と同じメールアドレスです" }, { status: 400 });
      }

      const isValid = await verifyPassword(currentPassword, user.password);
      if (!isValid) {
        return NextResponse.json({ error: "現在のパスワードが正しくありません" }, { status: 400 });
      }

      const existing = await prisma.user.findFirst({
        where: { email: trimmedEmail, id: { not: payload.userId } },
      });
      if (existing) {
        return NextResponse.json({ error: "このメールアドレスはすでに使用されています" }, { status: 400 });
      }

      const code = generateConfirmationCode();
      const pendingToken = await signScopedToken(
        {
          purpose: "email-change",
          userId: payload.userId,
          newEmail: trimmedEmail,
          code,
          sessionVersion: user.sessionVersion,
        },
        "15m"
      );

      try {
        await sendEmailChangeCode(trimmedEmail, code);
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "確認メールの送信に失敗しました。管理者に連絡してください。";
        return NextResponse.json({ error: message }, { status: 500 });
      }

      const response = NextResponse.json({
        emailChangePending: true,
        newEmail: trimmedEmail,
      });
      response.cookies.set(EMAIL_CHANGE_COOKIE, pendingToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: EMAIL_CHANGE_COOKIE_MAX_AGE,
        path: "/",
      });
      return response;
    }

    const dataToUpdate: Record<string, unknown> = {};
    let shouldRefreshAuthCookie = false;

    if (avatarUrl !== undefined) dataToUpdate.avatarUrl = avatarUrl;
    if (name !== undefined) dataToUpdate.name = name;
    if (birthDate !== undefined) dataToUpdate.birthDate = new Date(birthDate);
    if (gender !== undefined) dataToUpdate.gender = gender;
    if (isFirstLogin !== undefined) dataToUpdate.isFirstLogin = isFirstLogin;
    if (notificationsEnabled !== undefined) dataToUpdate.notificationsEnabled = notificationsEnabled;
    if (language !== undefined) dataToUpdate.language = language;
    if (timezone !== undefined) dataToUpdate.timezone = timezone;

    if (newPassword !== undefined) {
      if (!currentPassword) {
        return NextResponse.json({ error: "現在のパスワードを入力してください" }, { status: 400 });
      }
      const passwordError = validatePasswordStrength(newPassword);
      if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 });
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { password: true },
      });
      if (!user) {
        return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
      }
      const isValid = await verifyPassword(currentPassword, user.password);
      if (!isValid) {
        return NextResponse.json({ error: "現在のパスワードが正しくありません" }, { status: 400 });
      }
      dataToUpdate.password = await hashPassword(newPassword);
      dataToUpdate.sessionVersion = { increment: 1 };
      shouldRefreshAuthCookie = true;
    }

    if (Object.keys(dataToUpdate).length === 0) {
      return NextResponse.json({ error: "変更内容がありません" }, { status: 400 });
    }

    const updatedUser = await prisma.user.update({
      where: { id: payload.userId },
      data: dataToUpdate,
      select: {
        id: true,
        role: true,
        sessionVersion: true,
        avatarUrl: true,
        name: true,
        email: true,
        isFirstLogin: true,
        notificationsEnabled: true,
        language: true,
        timezone: true,
      },
    });

    const response = NextResponse.json(publicUser(updatedUser));
    if (shouldRefreshAuthCookie) {
      const newToken = await signToken({
        userId: updatedUser.id,
        role: updatedUser.role as "TEACHER" | "STUDENT",
        sessionVersion: updatedUser.sessionVersion,
      });
      setAuthCookie(response, newToken);
    }

    return response;
  } catch (error) {
    console.error("プロフィール更新エラー:", error);
    return NextResponse.json({ error: "プロフィールの更新に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = request.cookies.get(AUTH_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: "未認証" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "無効なトークン" }, { status: 401 });

    await prisma.$transaction(async (tx) => {
      await tx.file.deleteMany({ where: { uploadedById: payload.userId } });

      const reservations = await tx.reservation.findMany({ where: { studentId: payload.userId }, select: { id: true } });
      const resIds = reservations.map(r => r.id);
      if (resIds.length > 0) {
        await tx.lessonRecord.deleteMany({ where: { reservationId: { in: resIds } } });
        await tx.reservation.deleteMany({ where: { id: { in: resIds } } });
      }

      await tx.blockedSlot.deleteMany({ where: { teacherId: payload.userId } });
      await tx.message.deleteMany({ where: { authorId: payload.userId } });
      await tx.room.deleteMany({ where: { studentId: payload.userId } });

      await tx.user.delete({ where: { id: payload.userId } });
    });

    const response = NextResponse.json({ success: true });
    response.cookies.delete(AUTH_COOKIE);
    response.cookies.delete(EMAIL_CHANGE_COOKIE);
    return response;
  } catch (error) {
    console.error("アカウント削除エラー:", error);
    return NextResponse.json({ error: "アカウントの削除に失敗しました" }, { status: 500 });
  }
}
