import { NextRequest, NextResponse } from "next/server";
import { ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { getRealtimeServer } from "@/lib/realtime";
import { emitReservationUpdated } from "@/lib/reservation-events";
import { expireStripeCheckoutSession, refundStripePayment } from "@/lib/stripe";
import {
  buildReservationSystemMessage,
  getReservationErrorMessage,
  type ReservationErrorCode,
} from "@/lib/reservation-messages";

const STUDENT_CANCEL_LIMIT_HOURS = 24;

function reservationErrorResponse(errorCode: ReservationErrorCode, status: number) {
  return NextResponse.json(
    { errorCode, error: getReservationErrorMessage(errorCode, "ja") },
    { status }
  );
}

type ReservationMessage = {
  id: string;
  channelId: string;
  content: string;
  isSystem: boolean;
  isPinned: boolean;
  createdAt: Date;
  author: {
    id: string;
    name: string;
    role: "TEACHER" | "STUDENT";
    avatarUrl: string | null;
  };
};

function toSocketMessage(message: ReservationMessage) {
  return {
    id: message.id,
    channelId: message.channelId,
    content: message.content,
    isSystem: message.isSystem,
    isPinned: message.isPinned,
    isEdited: false,
    createdAt: message.createdAt.toISOString(),
    author: message.author,
    files: [],
    replyTo: null,
  };
}

type ReservationForCancellation = NonNullable<
  Awaited<ReturnType<typeof getReservationForCancellation>>
>;

async function getReservationForCancellation(id: string) {
  return prisma.reservation.findUnique({
    where: { id },
    include: {
      student: {
        select: { id: true, name: true },
      },
      lessonMenu: {
        select: {
          profile: {
            select: { stripeConnectedAccountId: true },
          },
        },
      },
    },
  });
}

function getReservationStripeAccountId(reservation: ReservationForCancellation) {
  return (
    reservation.stripeConnectedAccountId ||
    reservation.lessonMenu?.profile.stripeConnectedAccountId ||
    process.env.STRIPE_CONNECTED_ACCOUNT_ID ||
    null
  );
}

async function settleStripeBeforeCancellation(reservation: ReservationForCancellation) {
  const connectedAccountId = getReservationStripeAccountId(reservation);

  if (reservation.status === ReservationStatus.PENDING) {
    if (!reservation.stripeSessionId) return ReservationStatus.CANCELLED;
    if (!connectedAccountId) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }
    const result = await expireStripeCheckoutSession(reservation.stripeSessionId, connectedAccountId);
    if (result.paid) {
      throw new Error("CHECKOUT_ALREADY_PAID");
    }
    return ReservationStatus.CANCELLED;
  }

  if (reservation.status === ReservationStatus.CONFIRMED && reservation.stripePaymentId) {
    if (!connectedAccountId) {
      throw new Error("STRIPE_ACCOUNT_NOT_FOUND");
    }
    await refundStripePayment({
      paymentIntentId: reservation.stripePaymentId,
      connectedAccountId,
      reservationId: reservation.id,
    });
    return ReservationStatus.REFUNDED;
  }

  return ReservationStatus.CANCELLED;
}

/**
 * 予約キャンセルAPI
 * - 生徒: 自分の予約のみキャンセル可能
 * - 先生: すべての予約をキャンセル可能
 * 有料予約はStripe側のCheckout失効または返金を先に行ってから状態を更新する
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) {
      return reservationErrorResponse("AUTH_REQUIRED", 401);
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return reservationErrorResponse("AUTH_INVALID", 401);
    }

    const { id } = await params;

    const reservation = await getReservationForCancellation(id);

    if (!reservation) {
      return reservationErrorResponse("RESERVATION_NOT_FOUND", 404);
    }

    // 権限チェック: 生徒は自分の予約のみ、先生は全て
    const room = await prisma.room.findUnique({
      where: { studentId: reservation.studentId },
      select: {
        id: true,
        ownerId: true,
        studentId: true,
        channels: {
          where: { type: "CHAT" },
          select: { id: true },
        },
      },
    });

    if (!room) {
      return reservationErrorResponse("ROOM_NOT_FOUND", 404);
    }

    if (
      payload.role === "STUDENT" &&
      reservation.studentId !== payload.userId
    ) {
      return reservationErrorResponse("CANCEL_FORBIDDEN", 403);
    }

    if (
      payload.role === "STUDENT" &&
      reservation.status !== ReservationStatus.PENDING &&
      reservation.startTime.getTime() - Date.now() < STUDENT_CANCEL_LIMIT_HOURS * 60 * 60 * 1000
    ) {
      return reservationErrorResponse("CANCEL_TOO_LATE", 400);
    }

    if (reservation.status === ReservationStatus.CANCELLED) {
      return NextResponse.json({ success: true, status: ReservationStatus.CANCELLED });
    }

    if (reservation.status === ReservationStatus.REFUNDED) {
      return NextResponse.json({ success: true, status: ReservationStatus.REFUNDED });
    }

    if (reservation.status === ReservationStatus.COMPLETED) {
      return reservationErrorResponse("CANCEL_COMPLETED", 400);
    }

    if (payload.role === "TEACHER" && room.ownerId !== payload.userId) {
      return reservationErrorResponse("FORBIDDEN", 403);
    }

    let nextStatus: ReservationStatus;
    try {
      nextStatus = await settleStripeBeforeCancellation(reservation);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "CHECKOUT_ALREADY_PAID") {
        return reservationErrorResponse("CHECKOUT_ALREADY_PAID", 409);
      }
      if (message === "STRIPE_ACCOUNT_NOT_FOUND") {
        return reservationErrorResponse("STRIPE_ACCOUNT_NOT_FOUND", 409);
      }
      console.error("Stripe cancellation/refund failed:", error);
      return reservationErrorResponse("STRIPE_CANCEL_OR_REFUND_FAILED", 502);
    }

    await prisma.reservation.update({
      where: { id },
      data: { status: nextStatus },
    });

    // メインチャットチャンネルにキャンセル通知を投稿
    if (room && room.channels.length > 0) {
      const chatChannel = room.channels[0];

      const teacher = await prisma.user.findFirst({
        where: { id: room.ownerId },
        select: { id: true },
      });

      if (teacher) {
        const message = await prisma.message.create({
          data: {
            content: buildReservationSystemMessage({
              type: nextStatus === ReservationStatus.REFUNDED ? "reservation_refund_started" : "reservation_cancelled",
              start: reservation.startTime,
              end: reservation.endTime,
            }),
            channelId: chatChannel.id,
            authorId: teacher.id,
            isSystem: true,
          },
          include: {
            author: {
              select: { id: true, name: true, role: true, avatarUrl: true },
            },
          },
        });
        await prisma.room.update({
          where: { id: room.id },
          data: {
            lastMessage: message.content.split("\n")[0],
            lastMessageAt: message.createdAt,
          },
        });
        getRealtimeServer()?.to(`channel:${chatChannel.id}`).emit("new_message", toSocketMessage(message));
      }
    }

    await emitReservationUpdated(room, "cancelled", reservation.id);

    return NextResponse.json({ success: true, status: nextStatus });
  } catch {
    return reservationErrorResponse("RESERVATION_CANCEL_FAILED", 500);
  }
}
