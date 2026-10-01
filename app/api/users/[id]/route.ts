import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, validatePasswordStrength, verifyToken } from "@/lib/auth";

async function getOwnedStudent(teacherId: string, studentId: string) {
  const target = await prisma.user.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      role: true,
      studentRoom: {
        select: { ownerId: true },
      },
    },
  });

  if (!target) {
    return { ok: false as const, status: 404, error: "生徒が見つかりません" };
  }
  if (target.role !== "STUDENT") {
    return { ok: false as const, status: 403, error: "生徒アカウントだけ操作できます" };
  }
  if (target.studentRoom?.ownerId !== teacherId) {
    return { ok: false as const, status: 403, error: "この生徒を操作する権限がありません" };
  }

  return { ok: true as const, student: target };
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const targetUserId = params.id;

    if (!targetUserId || targetUserId === "undefined") {
      return NextResponse.json({ error: "ユーザーIDが不正です" }, { status: 400 });
    }

    const token = request.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "未認証" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    const ownership = await getOwnedStudent(payload.userId, targetUserId);
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    }

    await prisma.$transaction(async (tx) => {
      await tx.file.deleteMany({ where: { uploadedById: targetUserId } });

      const reservations = await tx.reservation.findMany({ where: { studentId: targetUserId }, select: { id: true } });
      const resIds = reservations.map(r => r.id);
      if (resIds.length > 0) {
        await tx.lessonRecord.deleteMany({ where: { reservationId: { in: resIds } } });
        await tx.reservation.deleteMany({ where: { id: { in: resIds } } });
      }

      await tx.blockedSlot.deleteMany({ where: { teacherId: targetUserId } });
      await tx.message.deleteMany({ where: { authorId: targetUserId } });
      await tx.room.deleteMany({ where: { studentId: targetUserId } });

      await tx.user.delete({ where: { id: targetUserId } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("ユーザー削除エラー:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const targetUserId = params.id;

    if (!targetUserId || targetUserId === "undefined") {
      return NextResponse.json({ error: "ユーザーIDが不正です" }, { status: 400 });
    }

    const token = request.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "未認証" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    const ownership = await getOwnedStudent(payload.userId, targetUserId);
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    }

    const body = await request.json();
    const { newPassword } = body;

    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const hashedPassword = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: targetUserId },
      data: {
        password: hashedPassword,
        sessionVersion: { increment: 1 },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("パスワードリセットエラー:", error);
    return NextResponse.json({ error: "パスワードの変更に失敗しました" }, { status: 500 });
  }
}
