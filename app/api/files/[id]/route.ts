import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { readFile, unlink } from "fs/promises";
import { sep } from "path";

const UPLOADS_ROOT = `${process.cwd()}${sep}uploads`;
const STORED_UPLOAD_PATH_PATTERN = /^uploads\/([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+)$/;
const INLINE_SAFE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "video/mp4",
  "video/webm",
  "text/plain",
]);

function resolveStoredUploadPath(storedPath: string): string | null {
  const normalizedPath = storedPath.replace(/\\/g, "/");
  const match = STORED_UPLOAD_PATH_PATTERN.exec(normalizedPath);

  if (!match) return null;

  const [, channelId, filename] = match;

  if (channelId.includes("..") || filename.includes("..")) {
    return null;
  }

  return `${UPLOADS_ROOT}${sep}${channelId}${sep}${filename}`;
}

/**
 * ファイル配信 API
 * GET /api/files/[id]
 * - DBからファイルのパスを取得し、ファイルを読み取ってレスポンスとして返す
 * - 認証 + 権限チェック付き
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) {
      return NextResponse.json({ error: "未認証" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "無効なトークン" }, { status: 401 });
    }

    const { id } = await params;

    // DBからファイル情報を取得
    const file = await prisma.file.findUnique({
      where: { id },
      include: {
        channel: {
          include: {
            room: {
              select: { ownerId: true, studentId: true },
            },
          },
        },
      },
    });

    if (!file) {
      return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
    }

    // 生徒のアクセス制限チェック
    if (payload.role === "STUDENT") {
      if (file.channel.room.studentId !== payload.userId) {
        return NextResponse.json({ error: "アクセス権がありません" }, { status: 403 });
      }
      if (file.channel.teacherOnly) {
        return NextResponse.json({ error: "このファイルへのアクセス権がありません" }, { status: 403 });
      }
    } else if (file.channel.room.ownerId !== payload.userId) {
      return NextResponse.json({ error: "アクセス権がありません" }, { status: 403 });
    }

    // ファイルを読み込み
    const filePath = resolveStoredUploadPath(file.path);
    if (!filePath) {
      return NextResponse.json({ error: "ファイルパスが不正です" }, { status: 400 });
    }
    const fileBuffer = await readFile(filePath);

    // レスポンスを返す
    const canShowInline = INLINE_SAFE_TYPES.has(file.mimeType);
    const disposition = canShowInline ? "inline" : "attachment";

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": file.size.toString(),
        "Content-Disposition": `${disposition}; filename="${encodeURIComponent(file.filename)}"`,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("ファイル配信エラー:", error);
    return NextResponse.json(
      { error: "ファイルの取得に失敗しました" },
      { status: 500 }
    );
  }
}

/**
 * ファイル削除 API
 * DELETE /api/files/[id]
 * - DBとディスクからファイルを削除する
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "未認証" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: "無効なトークン" }, { status: 401 });

    const { id } = await params;

    const file = await prisma.file.findUnique({
      where: { id },
      include: {
        channel: {
          include: {
            room: {
              select: { ownerId: true, studentId: true },
            },
          },
        },
      },
    });
    if (!file) return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });

    if (payload.role === "STUDENT") {
      if (file.channel.room.studentId !== payload.userId || file.channel.teacherOnly) {
        return NextResponse.json({ error: "削除権限がありません" }, { status: 403 });
      }
    } else if (file.channel.room.ownerId !== payload.userId) {
      return NextResponse.json({ error: "削除権限がありません" }, { status: 403 });
    }

    // 削除権限: 生徒は自分がアップロードしたファイルのみ、先生は自分のルーム内のファイルを削除可能
    if (payload.role === "STUDENT" && file.uploadedById !== payload.userId) {
      return NextResponse.json({ error: "削除権限がありません" }, { status: 403 });
    }

    // 物理ファイルを削除
    const filePath = resolveStoredUploadPath(file.path);
    if (!filePath) {
      return NextResponse.json({ error: "ファイルパスが不正です" }, { status: 400 });
    }
    try {
      await unlink(filePath);
    } catch (fsError) {
      // ファイルが存在しない場合は無視してDBから削除を進める
      if ((fsError as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error("物理ファイル削除エラー:", fsError);
      }
    }

    // DBからレコードを削除
    await prisma.file.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("ファイル削除エラー:", error);
    return NextResponse.json({ error: "ファイルの削除に失敗しました" }, { status: 500 });
  }
}
