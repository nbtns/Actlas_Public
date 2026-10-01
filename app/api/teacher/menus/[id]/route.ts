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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "未認証" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    const { id } = await params;
    const parsed = parseMenuPayload(await request.json());
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { name, description, price, specialPrice, duration } = parsed.data;

    const profile = await prisma.teacherProfile.findUnique({
      where: { userId: payload.userId },
    });

    if (!profile) {
      return NextResponse.json({ error: "プロフィールが見つかりません" }, { status: 404 });
    }

    const menu = await prisma.lessonMenu.findUnique({
      where: { id },
    });

    if (!menu || menu.profileId !== profile.id) {
      return NextResponse.json({ error: "メニューが見つかりません" }, { status: 404 });
    }

    const updatedMenu = await prisma.lessonMenu.update({
      where: { id },
      data: {
        name,
        description: description || null,
        price,
        specialPrice,
        duration,
      },
    });

    return NextResponse.json({ menu: updatedMenu });
  } catch (error) {
    console.error("Failed to update menu:", error);
    return NextResponse.json({ error: "メニューの更新に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "未認証" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    const { id } = await params;

    const profile = await prisma.teacherProfile.findUnique({
      where: { userId: payload.userId },
    });

    if (!profile) {
      return NextResponse.json({ error: "プロフィールが見つかりません" }, { status: 404 });
    }

    const menu = await prisma.lessonMenu.findUnique({
      where: { id },
    });

    if (!menu || menu.profileId !== profile.id) {
      return NextResponse.json({ error: "メニューが見つかりません" }, { status: 404 });
    }

    await prisma.lessonMenu.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete menu:", error);
    return NextResponse.json({ error: "メニューの削除に失敗しました" }, { status: 500 });
  }
}
