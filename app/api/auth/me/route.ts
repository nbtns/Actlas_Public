import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

/**
 * 現在ログイン中のユーザー情報を返すAPI
 * ページ読み込み時に「この人はログイン済みか？」を確認するために使う
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;

    if (!token) {
      return NextResponse.json(
        { error: "未認証" },
        { status: 401 }
      );
    }

    // トークンを検証
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "無効なトークン" },
        { status: 401 }
      );
    }

    // ユーザー情報をデータベースから取得（パスワードは含めない）
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        isFirstLogin: true,
        notificationsEnabled: true,
        language: true,
        timezone: true,
        birthDate: true,
        gender: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "ユーザーが見つかりません" },
        { status: 401 }
      );
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("me APIエラー:", error);
    return NextResponse.json(
      { error: "認証確認中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
