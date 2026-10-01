import { NextRequest, NextResponse } from "next/server";
import { ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { getRealtimeServer } from "@/lib/realtime";

const RESERVATION_LINK_PAST_HOURS = 12;
const RESERVATION_LINK_FUTURE_HOURS = 4;

type ReservationCandidate = {
  id: string;
  startTime: Date;
};

function pickClosestReservation(candidates: ReservationCandidate[], baseTime: Date) {
  return candidates
    .slice()
    .sort((a, b) => (
      Math.abs(a.startTime.getTime() - baseTime.getTime()) -
      Math.abs(b.startTime.getTime() - baseTime.getTime())
    ))[0] ?? null;
}

/**
 * 先生がレッスン完了を承認したときに呼ばれるAPI
 * そのルームの生徒のtotalLessonsを+1し、近い予約があればCOMPLETEDにする
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  try {
    const params = await context.params;
    const roomId = params.roomId;

    const token = request.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "未認証" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "権限がありません" }, { status: 403 });
    }

    // ルームから生徒IDを取得
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { ownerId: true, studentId: true },
    });

    if (!room) {
      return NextResponse.json({ error: "ルームが見つかりません" }, { status: 404 });
    }

    if (room.ownerId !== payload.userId) {
      return NextResponse.json({ error: "このルームのレッスンを完了する権限がありません" }, { status: 403 });
    }

    const now = new Date();
    const reservationWindowStart = new Date(now.getTime() - RESERVATION_LINK_PAST_HOURS * 60 * 60 * 1000);
    const reservationWindowEnd = new Date(now.getTime() + RESERVATION_LINK_FUTURE_HOURS * 60 * 60 * 1000);

    const result = await prisma.$transaction(async (tx) => {
      const reservationCandidates = await tx.reservation.findMany({
        where: {
          studentId: room.studentId,
          status: ReservationStatus.CONFIRMED,
          startTime: { lte: reservationWindowEnd },
          endTime: { gte: reservationWindowStart },
        },
        select: {
          id: true,
          startTime: true,
        },
      });
      const reservationToComplete = pickClosestReservation(reservationCandidates, now);

      const completedReservation = reservationToComplete
        ? await tx.reservation.update({
            where: { id: reservationToComplete.id },
            data: { status: ReservationStatus.COMPLETED },
            select: { id: true },
          })
        : null;

      const updatedStudent = await tx.user.update({
        where: { id: room.studentId },
        data: { totalLessons: { increment: 1 } },
        select: { totalLessons: true },
      });

      return {
        totalLessons: updatedStudent.totalLessons,
        completedReservationId: completedReservation?.id ?? null,
      };
    });

    if (result.completedReservationId) {
      const io = getRealtimeServer();
      io?.to(`user:${room.ownerId}`)
        .to(`user:${room.studentId}`)
        .emit("rooms_updated", { roomId, reason: "reservation" });
      io?.to(`user:${room.ownerId}`)
        .to(`user:${room.studentId}`)
        .emit("schedule_updated", {
          type: "reservation",
          action: "changed",
          roomId,
          studentId: room.studentId,
          reservationId: result.completedReservationId,
        });
    }

    console.log(`✅ レッスン回数を更新: 生徒${room.studentId} → ${result.totalLessons}回`);

    return NextResponse.json({
      success: true,
      totalLessons: result.totalLessons,
      completedReservationId: result.completedReservationId,
    });
  } catch (error) {
    console.error("レッスン回数更新エラー:", error);
    return NextResponse.json({ error: "レッスン回数の更新に失敗しました" }, { status: 500 });
  }
}
