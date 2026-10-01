import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

/**
 * チャンネル追加API
 * - 先生のみ実行可能
 * - 指定したルームにカスタムチャンネルを追加
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
    const { roomId, name, type, teacherOnly, icon } = body;

    if (!roomId || !name || !type) {
      return NextResponse.json(
        { error: "ルームID、チャンネル名、タイプは必須です" },
        { status: 400 }
      );
    }

    if (type === "YOUTUBE") {
      return NextResponse.json(
        { error: "YouTubeチャンネルは自動生成のみです" },
        { status: 400 }
      );
    }

    // 許可するチャンネルタイプの一覧
    const allowedTypes = [
      "CHAT", "CUSTOM",
    ];
    if (!allowedTypes.includes(type)) {
      return NextResponse.json(
        { error: "通常のテキストチャンネルのみ追加できます" },
        { status: 400 }
      );
    }

    // ルームの存在確認（先生が所有するルームのみ）
    const room = await prisma.room.findFirst({
      where: { id: roomId, ownerId: payload.userId },
    });
    if (!room) {
      return NextResponse.json(
        { error: "ルームが見つかりません" },
        { status: 404 }
      );
    }

    // 現在の最大positionを取得して、末尾に追加
    const maxPosition = await prisma.channel.aggregate({
      where: { roomId },
      _max: { position: true },
    });
    const newPosition = (maxPosition._max.position || 0) + 1;

    // チャンネルを作成
    const channel = await prisma.channel.create({
      data: {
        roomId,
        name: name.trim(),
        type,
        position: newPosition,
        teacherOnly: teacherOnly === true,
        icon: icon || null,
      },
    });

    return NextResponse.json({
      message: "チャンネルを作成しました",
      channel: {
        id: channel.id,
        name: channel.name,
        type: channel.type.toLowerCase(),
        position: channel.position,
        teacherOnly: channel.teacherOnly,
        icon: channel.icon,
      },
    });
  } catch (error) {
    console.error("チャンネル作成エラー:", error);
    return NextResponse.json(
      { error: "チャンネルの作成に失敗しました" },
      { status: 500 }
    );
  }
}
