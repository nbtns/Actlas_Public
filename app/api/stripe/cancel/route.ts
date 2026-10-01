import { NextRequest, NextResponse } from "next/server";
import { ReservationStatus } from "@prisma/client";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { emitReservationUpdated } from "@/lib/reservation-events";
import { expireStripeCheckoutSession } from "@/lib/stripe";

function buildReturnUrl(request: NextRequest, payment: "cancelled" | "error") {
  const returnUrl = new URL("/", request.nextUrl.origin);
  returnUrl.searchParams.set("payment", payment);
  return returnUrl;
}

export async function GET(request: NextRequest) {
  const reservationId = request.nextUrl.searchParams.get("reservationId");
  const token = request.cookies.get("token")?.value;
  if (!reservationId || !token) {
    return NextResponse.redirect(buildReturnUrl(request, "error"));
  }

  const payload = await verifyToken(token);
  if (!payload || payload.role !== "STUDENT") {
    return NextResponse.redirect(buildReturnUrl(request, "error"));
  }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true,
      status: true,
      studentId: true,
      stripeSessionId: true,
      stripeConnectedAccountId: true,
      lessonMenu: {
        select: {
          profile: {
            select: { stripeConnectedAccountId: true },
          },
        },
      },
    },
  });
  if (!reservation || reservation.studentId !== payload.userId) {
    return NextResponse.redirect(buildReturnUrl(request, "error"));
  }

  if (reservation.status === ReservationStatus.PENDING) {
    const connectedAccountId =
      reservation.stripeConnectedAccountId ||
      reservation.lessonMenu?.profile.stripeConnectedAccountId ||
      process.env.STRIPE_CONNECTED_ACCOUNT_ID ||
      null;

    if (reservation.stripeSessionId && !connectedAccountId) {
      return NextResponse.redirect(buildReturnUrl(request, "error"));
    }

    if (reservation.stripeSessionId && connectedAccountId) {
      try {
        const result = await expireStripeCheckoutSession(reservation.stripeSessionId, connectedAccountId);
        if (result.paid) {
          return NextResponse.redirect(buildReturnUrl(request, "error"));
        }
      } catch (error) {
        console.error("Stripe checkout expiration failed:", error);
        return NextResponse.redirect(buildReturnUrl(request, "error"));
      }
    }

    const updateResult = await prisma.reservation.updateMany({
      where: { id: reservation.id, status: ReservationStatus.PENDING },
      data: { status: ReservationStatus.CANCELLED },
    });

    if (updateResult.count > 0) {
      const room = await prisma.room.findUnique({
        where: { studentId: reservation.studentId },
        select: { id: true, ownerId: true, studentId: true },
      });
      if (room) {
        await emitReservationUpdated(room, "cancelled", reservation.id);
      }
    }
  }

  return NextResponse.redirect(buildReturnUrl(request, "cancelled"));
}
