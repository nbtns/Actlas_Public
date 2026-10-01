import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    // パストラバーサル対策（スラッシュ等のパス区切り文字を除去）
    const safeFilename = filename.replace(/[\/\\]/g, '');
    const filePath = join(process.cwd(), "public", "uploads", "avatars", safeFilename);
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";

    const fileBuffer = await readFile(filePath);

    const body = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    ) as ArrayBuffer;

    return new NextResponse(body, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=86400", // 1日キャッシュ
      },
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}
