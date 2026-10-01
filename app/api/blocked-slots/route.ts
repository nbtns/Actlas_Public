import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma, ReservationStatus } from "@prisma/client";
import { verifyToken } from "@/lib/auth";
import { getRealtimeServer } from "@/lib/realtime";
import { getReservationErrorMessage, type ReservationErrorCode } from "@/lib/reservation-messages";

const BLOCK_SLOT_MINUTES = 15;
const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = [
  ReservationStatus.PENDING,
  ReservationStatus.CONFIRMED,
];

function blockedSlotErrorResponse(errorCode: ReservationErrorCode, status: number) {
  return NextResponse.json(
    { errorCode, error: getReservationErrorMessage(errorCode, "ja") },
    { status }
  );
}

async function emitBlockedSlotsUpdated(teacherId?: string) {
  const io = getRealtimeServer();
  if (!io) return;

  const rooms = await prisma.room.findMany({
    where: teacherId ? { ownerId: teacherId } : undefined,
    select: { ownerId: true, studentId: true },
  });
  const userIds = new Set<string>();
  rooms.forEach((room) => {
    userIds.add(room.ownerId);
    userIds.add(room.studentId);
  });

  userIds.forEach((userId) => {
    io.to(`user:${userId}`).emit("schedule_updated", {
      type: "blocked-slot",
      action: "changed",
    });
  });
}

function getMonthDateFilter(month: string | null) {
  if (!month) return {};
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return {};

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || monthIndex < 0 || monthIndex > 11) return {};

  return {
    startTime: {
      gte: new Date(Date.UTC(year, monthIndex, 1)),
      lt: new Date(Date.UTC(year, monthIndex + 1, 1)),
    },
  };
}

function parseRequestDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function getVisibleTeacherId(payload: { role: string; userId: string }) {
  if (payload.role === "TEACHER") return payload.userId;

  const room = await prisma.room.findUnique({
    where: { studentId: payload.userId },
    select: { ownerId: true },
  });
  return room?.ownerId ?? null;
}

/**
 * ブロック時間帯（先生が予約不可に設定した時間）の取得API
 * 全ユーザーが閲覧可能（空き状況表示のため）
 * クエリパラメータ:
 *   ?month=2026-05 → 特定月のブロック時間帯を取得
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) {
      return blockedSlotErrorResponse("AUTH_REQUIRED", 401);
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return blockedSlotErrorResponse("AUTH_INVALID", 401);
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month");

    const teacherId = await getVisibleTeacherId(payload);
    if (!teacherId) {
      return NextResponse.json({ blockedSlots: [] });
    }

    const dateFilter = getMonthDateFilter(month);

    const blockedSlots = await prisma.blockedSlot.findMany({
      where: { ...dateFilter, teacherId },
      orderBy: { startTime: "asc" },
    });

    const formatted = blockedSlots.map((b) => ({
      id: b.id,
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      reason: b.reason,
    }));

    return NextResponse.json({ blockedSlots: formatted });
  } catch {
    return blockedSlotErrorResponse("BLOCKED_SLOTS_FETCH_FAILED", 500);
  }
}

/**
 * ブロック時間帯を作成するAPI（先生のみ）
 * 先生が特定の日時を予約不可に設定する
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) {
      return blockedSlotErrorResponse("AUTH_REQUIRED", 401);
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return blockedSlotErrorResponse("AUTH_INVALID", 401);
    }

    // 先生のみ設定可能
    if (payload.role !== "TEACHER") {
      return blockedSlotErrorResponse("BLOCK_TEACHER_ONLY", 403);
    }

    const body = await request.json();
    const { startTime, endTime, reason } = body;

    if (!startTime || !endTime) {
      return blockedSlotErrorResponse("BLOCK_TIME_REQUIRED", 400);
    }

    const start = parseRequestDate(startTime);
    const end = parseRequestDate(endTime);
    if (!start || !end || end <= start) {
      return blockedSlotErrorResponse("BLOCK_TIME_INVALID", 400);
    }

    if (end.getTime() - start.getTime() !== BLOCK_SLOT_MINUTES * 60000) {
      return blockedSlotErrorResponse("BLOCK_INTERVAL_INVALID", 400);
    }

    const ownedStudentIds = (
      await prisma.room.findMany({
        where: { ownerId: payload.userId },
        select: { studentId: true },
      })
    ).map((room) => room.studentId);

    // トランザクション化 (Serializableで並行実行時のダブルブッキングを完全防止)
    const blockedSlot = await prisma.$transaction(async (tx) => {
      // 既存の予約と被っていないかチェック（前後15分バッファ）
      const checkStart = new Date(start.getTime() - 15 * 60000);
      const checkEnd = new Date(end.getTime() + 15 * 60000);

      const overlappingReservation = await tx.reservation.findFirst({
        where: {
          studentId: { in: ownedStudentIds },
          status: { in: ACTIVE_RESERVATION_STATUSES },
          startTime: { lt: checkEnd },
          endTime: { gt: checkStart },
        },
      });

      if (overlappingReservation) {
        throw new Error("OVERLAPPING_RESERVATION");
      }

      // 重複するブロックがすでにないかチェック
      const overlappingBlocked = await tx.blockedSlot.findFirst({
        where: {
          teacherId: payload.userId,
          startTime: { lt: end },
          endTime: { gt: start },
        },
      });

      if (overlappingBlocked) {
        throw new Error("OVERLAPPING_BLOCKED_SLOT");
      }

      return await tx.blockedSlot.create({
        data: {
          startTime: start,
          endTime: end,
          reason: reason || null,
          teacherId: payload.userId,
        },
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    await emitBlockedSlotsUpdated(payload.userId);

    return NextResponse.json({
      blockedSlot: {
        id: blockedSlot.id,
        startTime: blockedSlot.startTime.toISOString(),
        endTime: blockedSlot.endTime.toISOString(),
        reason: blockedSlot.reason,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "OVERLAPPING_RESERVATION") {
      return blockedSlotErrorResponse("BLOCK_OVERLAPPING_RESERVATION", 409);
    }
    if (message === "OVERLAPPING_BLOCKED_SLOT") {
      return blockedSlotErrorResponse("BLOCK_OVERLAPPING_BLOCKED_SLOT", 409);
    }
    return blockedSlotErrorResponse("BLOCK_CREATE_FAILED", 500);
  }
}

/**
 * ブロック時間帯を削除するAPI（先生のみ）
 */
export async function DELETE(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) {
      return blockedSlotErrorResponse("AUTH_REQUIRED", 401);
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return blockedSlotErrorResponse("AUTH_INVALID", 401);
    }

    if (payload.role !== "TEACHER") {
      return blockedSlotErrorResponse("BLOCK_DELETE_TEACHER_ONLY", 403);
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return blockedSlotErrorResponse("BLOCK_ID_REQUIRED", 400);
    }

    const deleted = await prisma.blockedSlot.deleteMany({
      where: { id, teacherId: payload.userId },
    });
    if (deleted.count === 0) {
      return blockedSlotErrorResponse("BLOCK_NOT_FOUND", 404);
    }

    await emitBlockedSlotsUpdated(payload.userId);

    return NextResponse.json({ success: true });
  } catch {
    return blockedSlotErrorResponse("BLOCK_DELETE_FAILED", 500);
  }
}
