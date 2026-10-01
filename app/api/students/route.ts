import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken, hashPassword, validatePasswordStrength } from "@/lib/auth";

/**
 * 生徒アカウントを作成し、6チャンネル付きルームを自動生成するAPI
 * - 先生のみ実行可能
 * - 生徒用チャンネル4つ + 先生専用チャンネル2つ
 */
export async function POST(request: NextRequest) {
  try {
    // 認証チェック
    const token = request.cookies.get("token")?.value;
    if (!token) {
      return NextResponse.json({ error: "未認証" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json(
        { error: "先生アカウントのみ実行可能です" },
        { status: 403 }
      );
    }

    // リクエストボディを取得
    const body = await request.json();
    const { name, email, password, language } = body;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!name || !normalizedEmail || !password) {
      return NextResponse.json(
        { error: "名前、メールアドレス、パスワードは必須です" },
        { status: 400 }
      );
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // メールアドレスの重複チェック
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: "このメールアドレスは既に使用されています" },
        { status: 409 }
      );
    }

    // パスワードをハッシュ化
    const hashedPassword = await hashPassword(password);

    // トランザクションで生徒アカウント + ルーム + チャンネルを一括作成
    const result = await prisma.$transaction(async (tx) => {
      // 1. 生徒アカウントを作成
      const student = await tx.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          name,
          role: "STUDENT",
          language: language || "ja",
        },
      });

      // 2. 生徒のルームを作成
      const room = await tx.room.create({
        data: {
          name: `${name}のルーム`,
          ownerId: payload.userId,
          studentId: student.id,
        },
      });

      // 3. デフォルトの6チャンネルを作成
      await tx.channel.createMany({
        data: [
          // 生徒に見えるチャンネル（5つ）
          { roomId: room.id, name: "チャット", type: "CHAT", position: 1, teacherOnly: false },
          { roomId: room.id, name: "教材", type: "MATERIAL", position: 2, teacherOnly: false },
          { roomId: room.id, name: "予約", type: "BOOKING", position: 3, teacherOnly: false },
          { roomId: room.id, name: "メモ", type: "MEMO", position: 4, teacherOnly: false },
          { roomId: room.id, name: "同時視聴", type: "YOUTUBE", position: 5, teacherOnly: false },
          // 先生専用チャンネル（2つ）
          { roomId: room.id, name: "レッスン記録", type: "LESSON_RECORD", position: 6, teacherOnly: true },
          { roomId: room.id, name: "ダッシュボード", type: "DASHBOARD", position: 7, teacherOnly: true },
        ],
      });

      // 4. ダッシュボードにウェルカムメッセージを自動投稿
      const dashboardChannel = await tx.channel.findFirst({
        where: { roomId: room.id, type: "DASHBOARD" },
      });

      if (dashboardChannel) {
        await tx.message.create({
          data: {
            content: `📊 ${name}さんのダッシュボード\n\n🎸 レッスン回数: 0回\n📅 最終レッスン: まだなし\n📝 メモ: 新規生徒`,
            channelId: dashboardChannel.id,
            authorId: payload.userId,
            isSystem: true,
          },
        });
      }

      return { student, room };
    });

    return NextResponse.json({
      message: "生徒アカウントとルームを作成しました",
      student: {
        id: result.student.id,
        name: result.student.name,
        email: result.student.email,
      },
      room: {
        id: result.room.id,
        name: result.room.name,
      },
    });
  } catch (error) {
    console.error("生徒作成エラー:", error);
    return NextResponse.json(
      { error: "生徒の作成に失敗しました" },
      { status: 500 }
    );
  }
}
