import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma, ReservationStatus } from "@prisma/client";
import { verifyToken } from "@/lib/auth";
import { emitReservationUpdated, postReservationConfirmedMessage } from "@/lib/reservation-events";
import { createStripeCheckoutSession } from "@/lib/stripe";
import { getReservationErrorMessage, type ReservationErrorCode } from "@/lib/reservation-messages";

const TEACHER_TIMEZONE = "Asia/Tokyo";
const MIN_ADVANCE_MINUTES = 120;
const BUFFER_MINUTES = 15;
const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = [
  ReservationStatus.PENDING,
  ReservationStatus.CONFIRMED,
];

function reservationErrorResponse(errorCode: ReservationErrorCode, status: number, details?: Record<string, unknown>) {
  return NextResponse.json(
    { errorCode, error: getReservationErrorMessage(errorCode, "ja"), ...details },
    { status }
  );
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

function getZonedTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);

  const hourText = parts.find((part) => part.type === "hour")?.value;
  const minuteText = parts.find((part) => part.type === "minute")?.value;
  const hour = hourText === "24" ? 0 : Number(hourText);
  const minute = Number(minuteText);
  return { hour, minute };
}

function isTeacherBookableStart(start: Date) {
  const { hour, minute } = getZonedTimeParts(start, TEACHER_TIMEZONE);
  return minute % 15 === 0 && hour >= 7 && hour <= 14;
}

/**
 * 予約一覧を取得するAPI
 * - 先生: 全予約を取得
 * - 生徒: 自分の予約のみ取得し、他生徒の予約は匿名の埋まり時間として返す
 * クエリパラメータ:
 *   ?month=2026-05 → 特定月の予約を取得
 *   ?roomId=xxx → 特定ルーム（生徒）の予約を取得
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) {
      return reservationErrorResponse("AUTH_REQUIRED", 401);
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return reservationErrorResponse("AUTH_INVALID", 401);
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month"); // "2026-05" 形式
    const roomId = searchParams.get("roomId");

    // 日付フィルタの作成
    const dateFilter = getMonthDateFilter(month);

    // 権限に応じた取得条件
    const where: Record<string, unknown> = { ...dateFilter };
    let busySlots: Array<{ startTime: string; endTime: string }> = [];

    if (payload.role === "STUDENT") {
      // 生徒の予約一覧は自分の予約のみ。空き枠判定用に、同じ先生の埋まり時間だけ匿名で返す。
      where.studentId = payload.userId;

      const studentRoom = await prisma.room.findFirst({
        where: { studentId: payload.userId },
        select: { ownerId: true },
      });

      if (studentRoom) {
        const ownedRooms = await prisma.room.findMany({
          where: { ownerId: studentRoom.ownerId },
          select: { studentId: true },
        });

        const busyReservations = await prisma.reservation.findMany({
          where: {
            ...dateFilter,
            studentId: { in: ownedRooms.map((room) => room.studentId) },
            status: { in: ACTIVE_RESERVATION_STATUSES },
          },
          select: { startTime: true, endTime: true },
          orderBy: { startTime: "asc" },
        });

        busySlots = busyReservations.map((reservation) => ({
          startTime: reservation.startTime.toISOString(),
          endTime: reservation.endTime.toISOString(),
        }));
      }
    } else if (roomId) {
      // 先生が特定生徒の予約を見る場合
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { studentId: true, ownerId: true },
      });
      if (!room || room.ownerId !== payload.userId) {
        return reservationErrorResponse("FORBIDDEN", 403);
      }
      where.studentId = room.studentId;
    } else {
      const ownedRooms = await prisma.room.findMany({
        where: { ownerId: payload.userId },
        select: { studentId: true },
      });
      where.studentId = { in: ownedRooms.map((room) => room.studentId) };
    }

    const reservations = await prisma.reservation.findMany({
      where,
      include: {
        student: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
      orderBy: { startTime: "asc" },
    });

    const formatted = reservations.map((r) => ({
      id: r.id,
      startTime: r.startTime.toISOString(),
      endTime: r.endTime.toISOString(),
      status: r.status,
      notes: r.notes,
      student: r.student,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ reservations: formatted, busySlots });
  } catch {
    return reservationErrorResponse("RESERVATIONS_FETCH_FAILED", 500);
  }
}

/**
 * 予約を作成するAPI
 * 生徒予約はStripe決済待ち、先生代理予約は決済なしで即CONFIRMEDにする
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) {
      return reservationErrorResponse("AUTH_REQUIRED", 401);
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return reservationErrorResponse("AUTH_INVALID", 401);
    }

    const body = await request.json();
    const { startTime, notes, studentId, roomId, lessonMenuId } = body;

    if (!startTime) {
      return reservationErrorResponse("START_TIME_REQUIRED", 400);
    }

    if (typeof lessonMenuId !== "string" || !lessonMenuId.trim()) {
      return reservationErrorResponse("LESSON_MENU_REQUIRED", 400);
    }

    const start = parseRequestDate(startTime);
    if (!start) {
      return reservationErrorResponse("START_TIME_INVALID", 400);
    }

    const now = new Date();

    // 過去の日時はNG
    if (start < now) {
      return reservationErrorResponse("PAST_TIME", 400);
    }

    if (start.getTime() - now.getTime() < MIN_ADVANCE_MINUTES * 60000) {
      return reservationErrorResponse("MIN_ADVANCE_REQUIRED", 400);
    }

    if (!isTeacherBookableStart(start)) {
      return reservationErrorResponse("UNBOOKABLE_TIME", 400);
    }

    // 予約対象の生徒IDを決定
    // 先生が特定生徒の予約を作る場合はstudentIdまたはroomIdから取得
    let targetStudentId = payload.userId; // デフォルトは自分自身
    if (payload.role === "TEACHER") {
      if (studentId) {
        targetStudentId = studentId;
      } else if (roomId) {
        const room = await prisma.room.findUnique({
          where: { id: roomId },
          select: { studentId: true },
        });
        if (room) {
          targetStudentId = room.studentId;
        }
      }
    }

    const targetRoom = await prisma.room.findUnique({
      where: { studentId: targetStudentId },
      select: { id: true, ownerId: true, studentId: true },
    });
    if (!targetRoom) {
      return reservationErrorResponse("STUDENT_ROOM_NOT_FOUND", 404);
    }
    if (payload.role === "TEACHER" && targetRoom.ownerId !== payload.userId) {
      return reservationErrorResponse("FORBIDDEN", 403);
    }

    const menu = await prisma.lessonMenu.findFirst({
      where: { id: lessonMenuId, profile: { userId: targetRoom.ownerId } },
      select: {
        id: true,
        name: true,
        price: true,
        specialPrice: true,
        duration: true,
        profile: {
          select: { stripeConnectedAccountId: true },
        },
      },
    });
    if (!menu || menu.duration <= 0) {
      return reservationErrorResponse("LESSON_MENU_UNAVAILABLE", 400);
    }

    const end = new Date(start.getTime() + menu.duration * 60000);
    const checkStart = new Date(start.getTime() - BUFFER_MINUTES * 60000);
    const checkEnd = new Date(end.getTime() + BUFFER_MINUTES * 60000);

    const ownedStudentIds = (
      await prisma.room.findMany({
        where: { ownerId: targetRoom.ownerId },
        select: { studentId: true },
      })
    ).map((room) => room.studentId);

    const student = await prisma.user.findUnique({
      where: { id: targetStudentId },
      select: { email: true, specialOfferEligible: true },
    });
    if (!student) {
      return reservationErrorResponse("STUDENT_NOT_FOUND", 404);
    }
    const amountPaid =
      student.specialOfferEligible && menu.specialPrice !== null ? menu.specialPrice : menu.price;
    const isTeacherCreated = payload.role === "TEACHER";
    const requiresStripePayment = !isTeacherCreated && amountPaid > 0;
    const isStudentFreeBooking = !isTeacherCreated && amountPaid === 0;
    const connectedAccountId = menu.profile.stripeConnectedAccountId || process.env.STRIPE_CONNECTED_ACCOUNT_ID;

    if (amountPaid < 0) {
      return reservationErrorResponse("INVALID_MENU_PRICE", 400);
    }

    if (requiresStripePayment && !connectedAccountId) {
      return reservationErrorResponse("STRIPE_NOT_CONNECTED", 400);
    }

    // 生徒予約は決済完了WebhookでCONFIRMEDにし、先生代理予約はここで即CONFIRMEDにする。
    const status = requiresStripePayment ? ReservationStatus.PENDING : ReservationStatus.CONFIRMED;

    // トランザクション化 (Serializableで並行実行時のダブルブッキングを完全防止)
    const reservation = await prisma.$transaction(async (tx) => {
      if (isStudentFreeBooking) {
        const existingFreeReservation = await tx.reservation.findFirst({
          where: {
            studentId: targetStudentId,
            amountPaid: 0,
          },
          select: { id: true },
        });
        if (existingFreeReservation) {
          throw new Error("FREE_TRIAL_ALREADY_USED");
        }
      }

      // 重複チェック: 前後15分の休憩時間を含めて既存予約がないか確認
      const overlapping = await tx.reservation.findFirst({
        where: {
          studentId: { in: ownedStudentIds },
          status: { in: ACTIVE_RESERVATION_STATUSES },
          startTime: { lt: checkEnd },
          endTime: { gt: checkStart },
        },
      });

      if (overlapping) {
        throw new Error("OVERLAPPING_RESERVATION");
      }

      // ブロック時間帯のチェック（前後15分バッファ含む）
      const blocked = await tx.blockedSlot.findFirst({
        where: {
          teacherId: targetRoom.ownerId,
          startTime: { lt: checkEnd },
          endTime: { gt: checkStart },
        },
      });

      if (blocked) {
        throw new Error("BLOCKED_SLOT");
      }

      return await tx.reservation.create({
        data: {
          startTime: start,
          endTime: end,
          status,
          notes: notes || null,
          studentId: targetStudentId,
          lessonMenuId: menu.id,
          amountPaid,
          stripeConnectedAccountId: requiresStripePayment ? connectedAccountId : null,
        },
        include: {
          student: {
            select: { id: true, name: true, avatarUrl: true },
          },
        },
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    let checkoutUrl: string | null = null;

    if (requiresStripePayment) {
      try {
        const baseUrl =
          process.env.NEXT_PUBLIC_APP_URL ||
          process.env.APP_URL ||
          request.nextUrl.origin;
        const successUrl = new URL("/", baseUrl);
        successUrl.searchParams.set("payment", "success");
        successUrl.searchParams.set("reservationId", reservation.id);
        const cancelUrl = new URL("/api/stripe/cancel", baseUrl);
        cancelUrl.searchParams.set("reservationId", reservation.id);

        const checkoutSession = await createStripeCheckoutSession({
          reservationId: reservation.id,
          studentId: targetStudentId,
          studentEmail: student.email,
          connectedAccountId,
          lessonMenuId: menu.id,
          menuName: menu.name,
          amountUsd: amountPaid,
          durationMinutes: menu.duration,
          successUrl: successUrl.toString(),
          cancelUrl: cancelUrl.toString(),
        });

        await prisma.reservation.update({
          where: { id: reservation.id },
          data: { stripeSessionId: checkoutSession.id },
        });
        checkoutUrl = checkoutSession.url;
      } catch (stripeError) {
        await prisma.reservation.update({
          where: { id: reservation.id },
          data: { status: ReservationStatus.CANCELLED },
        });
        console.error("Stripe checkout creation failed:", stripeError);
        return reservationErrorResponse("STRIPE_CHECKOUT_CREATE_FAILED", 502);
      }
    }

    if (!requiresStripePayment) {
      await postReservationConfirmedMessage({
        studentId: targetStudentId,
        start,
        end,
        notes: notes || null,
        isTeacherCreated,
      });
    }

    await emitReservationUpdated(targetRoom, "created", reservation.id);

    return NextResponse.json({
      reservation: {
        id: reservation.id,
        startTime: reservation.startTime.toISOString(),
        endTime: reservation.endTime.toISOString(),
        status: reservation.status,
        notes: reservation.notes,
        student: reservation.student,
        createdAt: reservation.createdAt.toISOString(),
      },
      checkoutUrl,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "OVERLAPPING_RESERVATION") {
      return reservationErrorResponse("OVERLAPPING_RESERVATION", 409);
    }
    if (message === "BLOCKED_SLOT") {
      return reservationErrorResponse("BLOCKED_SLOT", 409);
    }
    if (message === "FREE_TRIAL_ALREADY_USED") {
      return reservationErrorResponse("FREE_TRIAL_ALREADY_USED", 409);
    }
    if (message === "INVALID_LESSON_MENU") {
      return reservationErrorResponse("LESSON_MENU_UNAVAILABLE", 400);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return reservationErrorResponse("CONCURRENT_RESERVATION", 409);
    }
    console.error("Reservation Error Details:", error);
    return reservationErrorResponse("RESERVATION_CREATE_FAILED", 500, { details: message });
  }
}
