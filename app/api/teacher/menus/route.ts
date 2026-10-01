import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

function parseMenuPayload(body: {
  name?: unknown;
  description?: unknown;
  price?: unknown;
  specialPrice?: unknown;
  duration?: unknown;
}) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const price = Number(body.price);
  const specialPrice =
    body.specialPrice === null || body.specialPrice === undefined || body.specialPrice === ""
      ? null
      : Number(body.specialPrice);
  const duration = Number(body.duration);

  if (!name || body.price === undefined || body.duration === undefined) {
    return { error: "必須項目が不足しています" } as const;
  }
  if (!Number.isInteger(price) || price < 0) {
    return { error: "通常料金は0ドル以上の整数で入力してください" } as const;
  }
  if (specialPrice !== null && (!Number.isInteger(specialPrice) || specialPrice < 0)) {
    return { error: "特価料金は0ドル以上の整数で入力してください" } as const;
  }
  if (specialPrice !== null && specialPrice > price) {
    return { error: "特価料金は通常料金以下にしてください" } as const;
  }
  if (!Number.isInteger(duration) || duration < 15 || duration > 240 || duration % 15 !== 0) {
    return { error: "時間は15分から240分までの15分単位で入力してください" } as const;
  }

  return { data: { name, description, price, specialPrice, duration } } as const;
}

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "未認証" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    // 先生のプロフィールを取得
    const profile = await prisma.teacherProfile.findUnique({
      where: { userId: payload.userId },
    });

    if (!profile) {
      return NextResponse.json({ menus: [] });
    }

    const menus = await prisma.lessonMenu.findMany({
      where: { profileId: profile.id },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({ menus });
  } catch (error) {
    console.error("Failed to fetch menus:", error);
    return NextResponse.json({ error: "メニューの取得に失敗しました" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "未認証" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    let profile = await prisma.teacherProfile.findUnique({
      where: { userId: payload.userId },
    });

    // プロフィールが存在しない場合は自動作成
    if (!profile) {
      profile = await prisma.teacherProfile.create({
        data: {
          userId: payload.userId,
          username: `teacher_${payload.userId.substring(0, 8)}`,
        },
      });
    }

    const parsed = parseMenuPayload(await request.json());
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { name, description, price, specialPrice, duration } = parsed.data;

    const lastMenu = await prisma.lessonMenu.aggregate({
      where: { profileId: profile.id },
      _max: { displayOrder: true },
    });

    const menu = await prisma.lessonMenu.create({
      data: {
        name,
        description: description || null,
        price,
        specialPrice,
        duration,
        displayOrder: (lastMenu._max.displayOrder ?? -1) + 1,
        profileId: profile.id,
      },
    });

    return NextResponse.json({ menu });
  } catch (error) {
    console.error("Failed to create menu:", error);
    return NextResponse.json({ error: "メニューの作成に失敗しました" }, { status: 500 });
  }
}
