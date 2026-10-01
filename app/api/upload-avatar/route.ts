import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) {
      return NextResponse.json({ error: "未認証" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "無効なトークン" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "ファイルがありません" }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "ファイルサイズは5MB以下にしてください" }, { status: 400 });
    }

    const ext = ALLOWED_AVATAR_TYPES[file.type];
    if (!ext) {
      return NextResponse.json({ error: "画像ファイルを選択してください" }, { status: 400 });
    }

    const uploadDir = join(process.cwd(), "public", "uploads", "avatars");
    await mkdir(uploadDir, { recursive: true });

    const uniqueName = `${randomUUID()}.${ext}`;
    // パストラバーサル対策
    const safeUniqueName = uniqueName.replace(/[\/\\]/g, '');
    const filePath = join(uploadDir, safeUniqueName);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(filePath, buffer);

    const url = `/api/avatars/${safeUniqueName}`;

    return NextResponse.json({ url });
  } catch (error) {
    console.error("アバターアップロードエラー:", error);
    return NextResponse.json({ error: "アップロードに失敗しました" }, { status: 500 });
  }
}
