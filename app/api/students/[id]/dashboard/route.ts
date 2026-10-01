import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

async function teacherOwnsStudent(teacherId: string, studentId: string) {
  const room = await prisma.room.findUnique({
    where: { studentId },
    select: { ownerId: true },
  });
  return room?.ownerId === teacherId;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const token = request.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "未認証" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      // 生徒本人の場合は許可するか？
      // 今回は先生または本人が見れるようにする
      if (!payload || (payload.role !== "TEACHER" && payload.userId !== params.id)) {
        return NextResponse.json({ error: "権限がありません" }, { status: 403 });
      }
    }

    const studentId = params.id;
    if (payload.role === "TEACHER" && !(await teacherOwnsStudent(payload.userId, studentId))) {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        name: true,
        email: true,
        birthDate: true,
        gender: true,
        hobbies: true,
        favoriteArtists: true,
        goals: true,
        totalLessons: true,
        specialOfferEligible: true,
        avatarUrl: true,
        language: true,
      },
    });

    if (!student) {
      return NextResponse.json({ error: "生徒が見つかりません" }, { status: 404 });
    }

    return NextResponse.json({ student });
  } catch (error) {
    console.error("ダッシュボード情報取得エラー:", error);
    return NextResponse.json({ error: "情報の取得に失敗しました" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const token = request.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "未認証" }, { status: 401 });

    const payload = await verifyToken(token);
    // 先生のみ更新可能とする（あるいは本人のみ）
    // ダッシュボードの大部分（趣味、目標など）は先生が手動で追加したいとのことなので、
    // ここは先生からのリクエストであることを確認する。
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    const studentId = params.id;
    if (!(await teacherOwnsStudent(payload.userId, studentId))) {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    const body = await request.json();
    
    const dataToUpdate: Record<string, unknown> = {};
    if (body.hobbies !== undefined) dataToUpdate.hobbies = body.hobbies;
    if (body.favoriteArtists !== undefined) dataToUpdate.favoriteArtists = body.favoriteArtists;
    if (body.goals !== undefined) dataToUpdate.goals = body.goals;
    if (body.totalLessons !== undefined) {
      const lessons = parseInt(body.totalLessons, 10);
      dataToUpdate.totalLessons = isNaN(lessons) ? 0 : lessons;
    }
    if (body.specialOfferEligible !== undefined) {
      dataToUpdate.specialOfferEligible = body.specialOfferEligible === true;
    }
    // 先生が基本情報も修正できるようにしておく
    if (body.name !== undefined) dataToUpdate.name = body.name;
    if (body.gender !== undefined) dataToUpdate.gender = body.gender;
    if (body.birthDate !== undefined) dataToUpdate.birthDate = body.birthDate ? new Date(body.birthDate) : null;

    const updatedStudent = await prisma.user.update({
      where: { id: studentId },
      data: dataToUpdate,
      select: {
        id: true,
        name: true,
        email: true,
        birthDate: true,
        gender: true,
        hobbies: true,
        favoriteArtists: true,
        goals: true,
        totalLessons: true,
        specialOfferEligible: true,
        avatarUrl: true,
        language: true,
      },
    });

    return NextResponse.json({ student: updatedStudent });
  } catch (error) {
    console.error("ダッシュボード情報更新エラー:", error);
    return NextResponse.json({ error: "情報の更新に失敗しました" }, { status: 500 });
  }
}
