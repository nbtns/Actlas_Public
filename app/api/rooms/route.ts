import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

/**
 * ルーム一覧を取得するAPI
 * - 先生: 自分が所有するルームのみ取得（生徒一覧サイドバー用）
 * - 生徒: 自分のルームのみ取得
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) {
      return NextResponse.json({ error: "未認証" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "無効なトークン" }, { status: 401 });
    }

    // ルームの取得条件を権限に応じて変更
    const where =
      payload.role === "TEACHER"
        ? { ownerId: payload.userId } // 先生は自分のルームのみ
        : { studentId: payload.userId }; // 生徒は自分のルームのみ

    const rooms = await prisma.room.findMany({
      where,
      include: {
        student: {
          select: { id: true, name: true, avatarUrl: true, email: true },
        },
        owner: {
          select: { id: true, name: true },
        },
        channels: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            name: true,
            type: true,
            position: true,
            teacherOnly: true,
            icon: true,
          },
        },
        // 各ルームの最新メッセージ（プレビュー用）
        _count: {
          select: { channels: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // 非正規化された lastMessage を使用（N+1クエリ解消）
    // 生徒の場合は先生専用チャンネルをフィルタリングして非表示にする
    const isStudent = payload.role === "STUDENT";

    const roomsWithLastMessage = rooms.map((room) => ({
      id: room.id,
      name: room.name,
      student: room.student,
      owner: { id: room.owner.id, name: room.owner.name },
      channels: room.channels
        .filter((c) => !isStudent || !c.teacherOnly) // 生徒には先生専用チャンネルを非表示
        .map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type.toLowerCase(), // フロントエンド用にlowercaseに変換
          position: c.position,
          teacherOnly: c.teacherOnly,
          icon: c.icon,
        })),
      lastMessage: room.lastMessage,
      lastMessageAt: room.lastMessageAt ? room.lastMessageAt.toISOString() : null,
    }));

    return NextResponse.json({ rooms: roomsWithLastMessage });
  } catch {
    return NextResponse.json(
      { error: "ルーム一覧の取得に失敗しました" },
      { status: 500 }
    );
  }
}
