import { NextRequest, NextResponse } from "next/server";
import { ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emitReservationUpdated, postReservationConfirmedMessage } from "@/lib/reservation-events";
import {
  constructStripeWebhookEvent,
  getStripePaymentIntentId,
  type StripeCheckoutSessionObject,
} from "@/lib/stripe";

export const runtime = "nodejs";

function getReservationIdFromSession(session: StripeCheckoutSessionObject) {
  return session.metadata?.reservationId || session.client_reference_id || null;
}

async function getReservationRoom(studentId: string) {
  return prisma.room.findUnique({
    where: { studentId },
    select: { id: true, ownerId: true, studentId: true },
  });
}

function getExpectedStripeAccountId(reservation: {
  stripeConnectedAccountId?: string | null;
  lessonMenu?: { profile?: { stripeConnectedAccountId: string | null } | null } | null;
}) {
  return (
    reservation.stripeConnectedAccountId ||
    reservation.lessonMenu?.profile?.stripeConnectedAccountId ||
    process.env.STRIPE_CONNECTED_ACCOUNT_ID ||
    null
  );
}

async function handleCheckoutPaid(session: StripeCheckoutSessionObject, eventAccount?: string) {
  const reservationId = getReservationIdFromSession(session);
  if (!reservationId) return;
  if (session.payment_status && session.payment_status !== "paid") return;

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      notes: true,
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
  if (!reservation) return;
  if (reservation.status === ReservationStatus.CONFIRMED) return;
  if (reservation.status !== ReservationStatus.PENDING) return;
  if (session.id && reservation.stripeSessionId && reservation.stripeSessionId !== session.id) return;
  const expectedAccountId = getExpectedStripeAccountId(reservation);
  if (eventAccount && expectedAccountId && eventAccount !== expectedAccountId) return;

  const paymentIntentId = getStripePaymentIntentId(session);
  const updateResult = await prisma.reservation.updateMany({
    where: { id: reservation.id, status: ReservationStatus.PENDING },
    data: {
      status: ReservationStatus.CONFIRMED,
      ...(session.id ? { stripeSessionId: session.id } : {}),
      ...(paymentIntentId ? { stripePaymentId: paymentIntentId } : {}),
      ...(expectedAccountId || eventAccount
        ? { stripeConnectedAccountId: expectedAccountId || eventAccount }
        : {}),
    },
  });
  if (updateResult.count === 0) return;

  await postReservationConfirmedMessage({
    studentId: reservation.studentId,
    start: reservation.startTime,
    end: reservation.endTime,
    notes: reservation.notes,
    isTeacherCreated: false,
  });

  const room = await getReservationRoom(reservation.studentId);
  if (room) {
    await emitReservationUpdated(room, "created", reservation.id);
  }
}

async function handleCheckoutReleased(session: StripeCheckoutSessionObject, eventAccount?: string) {
  const reservationId = getReservationIdFromSession(session);
  if (!reservationId) return;

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
  if (!reservation) return;
  if (reservation.status !== ReservationStatus.PENDING) return;
  if (session.id && reservation.stripeSessionId && reservation.stripeSessionId !== session.id) return;
  const expectedAccountId = getExpectedStripeAccountId(reservation);
  if (eventAccount && expectedAccountId && eventAccount !== expectedAccountId) return;

  const updateResult = await prisma.reservation.updateMany({
    where: { id: reservation.id, status: ReservationStatus.PENDING },
    data: { status: ReservationStatus.CANCELLED },
  });
  if (updateResult.count === 0) return;

  const room = await getReservationRoom(reservation.studentId);
  if (room) {
    await emitReservationUpdated(room, "cancelled", reservation.id);
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.text();
  let event;

  try {
    event = constructStripeWebhookEvent(payload, request.headers.get("stripe-signature"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe webhook.";
    const status = message.includes("STRIPE_WEBHOOK_SECRET") ? 500 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  try {
    const session = event.data.object as StripeCheckoutSessionObject;
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      await handleCheckoutPaid(session, event.account);
    } else if (
      event.type === "checkout.session.expired" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      await handleCheckoutReleased(session, event.account);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook handling failed:", error);
    return NextResponse.json({ error: "Stripe webhook handling failed." }, { status: 500 });
  }
}
