import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

/** アップロード可能な最大ファイルサイズ（20MB） */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** 許可するMIMEタイプ */
const ALLOWED_TYPES = new Set([
  // 画像
  "image/jpeg", "image/png", "image/gif", "image/webp",
  // PDF
  "application/pdf",
  // 音声
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/aac", "audio/flac", "audio/m4a",
  // 動画
  "video/mp4", "video/webm",
  // ドキュメント
  "text/plain",
  // 教材関連
  "application/xml", "text/xml",
  // ZIP
  "application/zip", "application/x-zip-compressed", "multipart/x-zip",
]);

const EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/m4a",
  mp4: "video/mp4",
  webm: "video/webm",
  txt: "text/plain",
  xml: "application/xml",
  zip: "application/zip",
};

const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

function resolveAllowedMimeType(file: File): string | null {
  const mimeType = file.type.toLowerCase();
  const extension = getFileExtension(file.name);

  if (mimeType === "image/svg+xml" || extension === "svg") {
    return null;
  }

  if (ALLOWED_TYPES.has(mimeType)) {
    return extension === "zip" ? "application/zip" : mimeType;
  }

  if (!GENERIC_MIME_TYPES.has(mimeType)) {
    return null;
  }

  return EXTENSION_MIME_TYPES[extension] ?? null;
}

/**
 * ファイルアップロード API
 * POST /api/files
 * - multipart/form-data で送信
 * - file: アップロードするファイル
 * - channelId: 添付先のチャンネルID
 * - messageId?: 添付先のメッセージID（任意）
 */
export async function POST(request: NextRequest) {
  try {
    // 認証チェック
    const token = request.cookies.get("token")?.value;
    if (!token) {
      return NextResponse.json({ code: "unauthorized", error: "未認証" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ code: "unauthorized", error: "無効なトークン" }, { status: 401 });
    }

    // multipart/form-data を解析
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const channelId = formData.get("channelId") as string | null;

    if (!file) {
      return NextResponse.json({ code: "missing-file", error: "ファイルが選択されていません" }, { status: 400 });
    }

    if (!channelId) {
      return NextResponse.json({ code: "missing-channel", error: "チャンネルIDが必要です" }, { status: 400 });
    }

    // ファイルサイズチェック
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { code: "file-too-large", error: `ファイルサイズが上限（${MAX_FILE_SIZE / 1024 / 1024}MB）を超えています` },
        { status: 400 }
      );
    }

    // MIMEタイプチェック
    const storedMimeType = resolveAllowedMimeType(file);
    if (!storedMimeType) {
      return NextResponse.json(
        { code: "unsupported-file-type", error: "このファイル形式はサポートされていません" },
        { status: 400 }
      );
    }

    // チャンネルの存在確認 + アクセス権限
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        room: {
          select: { ownerId: true, studentId: true },
        },
      },
    });

    if (!channel) {
      return NextResponse.json({ code: "channel-not-found", error: "チャンネルが見つかりません" }, { status: 404 });
    }

    // 生徒のアクセス制限チェック
    if (payload.role === "STUDENT") {
      if (channel.room.studentId !== payload.userId) {
        return NextResponse.json({ code: "forbidden", error: "このチャンネルへのアクセス権がありません" }, { status: 403 });
      }
      if (channel.teacherOnly) {
        return NextResponse.json({ code: "forbidden", error: "このチャンネルは先生専用です" }, { status: 403 });
      }
    } else if (channel.room.ownerId !== payload.userId) {
      return NextResponse.json({ code: "forbidden", error: "このチャンネルへのアクセス権がありません" }, { status: 403 });
    }

    // アップロードディレクトリを作成
    // パストラバーサル対策
    const safeChannelId = channelId.replace(/[\/\\]/g, '');
    const uploadDir = join(process.cwd(), "uploads", safeChannelId);
    await mkdir(uploadDir, { recursive: true });

    // ユニークなファイル名を生成（衝突防止）
    const ext = file.name.split(".").pop() || "";
    const uniqueName = `${randomUUID()}${ext ? `.${ext}` : ""}`;
    const safeUniqueName = uniqueName.replace(/[\/\\]/g, '');
    const filePath = join(uploadDir, safeUniqueName);

    // ファイルをディスクに保存
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(filePath, buffer);

    // DBにファイル情報を保存
    const fileRecord = await prisma.file.create({
      data: {
        filename: file.name,
        path: `uploads/${safeChannelId}/${safeUniqueName}`,
        mimeType: storedMimeType,
        size: file.size,
        uploadedById: payload.userId,
        channelId,
      },
    });

    return NextResponse.json({
      file: {
        id: fileRecord.id,
        filename: fileRecord.filename,
        mimeType: fileRecord.mimeType,
        size: fileRecord.size,
        url: `/api/files/${fileRecord.id}`,
      },
    });
  } catch (error) {
    console.error("ファイルアップロードエラー:", error);
    return NextResponse.json(
      { code: "upload-failed", error: "ファイルのアップロードに失敗しました" },
      { status: 500 }
    );
  }
}
