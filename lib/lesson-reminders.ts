import { ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildNotificationUrl, sendAppNotification } from "@/lib/notifications";

const REMINDER_OFFSETS_MINUTES = [30, 10] as const;
const REMINDER_WINDOW_MS = 90 * 1000;
const REMINDER_LOOKBACK_MS = 15 * 60 * 1000;
const REMINDER_CLAIM_TIMEOUT_MS = 45 * 1000;
const MAX_REMINDER_ATTEMPTS = 5;

function isDuplicateReminder(error: unknown) {
  return (error as { code?: string } | null)?.code === "P2002";
}

function reminderTitle(offsetMinutes: number) {
  return {
    ja: `レッスン開始${offsetMinutes}分前です`,
    en: `Lesson starts in ${offsetMinutes} minutes`,
  };
}

async function claimReminder(reservationId: string, offsetMinutes: number, now: Date) {
  try {
    return await prisma.reservationReminder.create({
      data: {
        reservationId,
        offsetMinutes,
        attempts: 1,
        lastAttemptAt: now,
      },
    });
  } catch (error) {
    if (!isDuplicateReminder(error)) throw error;
  }

  const staleBefore = new Date(now.getTime() - REMINDER_CLAIM_TIMEOUT_MS);
  const claimed = await prisma.reservationReminder.updateMany({
    where: {
      reservationId,
      offsetMinutes,
      sentAt: null,
      attempts: { lt: MAX_REMINDER_ATTEMPTS },
      OR: [
        { lastAttemptAt: null },
        { lastAttemptAt: { lt: staleBefore } },
      ],
    },
    data: {
      attempts: { increment: 1 },
      lastAttemptAt: now,
      lastError: null,
    },
  });
  if (claimed.count === 0) return null;

  return prisma.reservationReminder.findUnique({
    where: { reservationId_offsetMinutes: { reservationId, offsetMinutes } },
  });
}

export async function sendUpcomingLessonReminders(now = new Date()) {
  for (const offsetMinutes of REMINDER_OFFSETS_MINUTES) {
    const idealStart = now.getTime() + offsetMinutes * 60 * 1000;
    const windowStart = new Date(Math.max(now.getTime(), idealStart - REMINDER_LOOKBACK_MS));
    const windowEnd = new Date(idealStart + REMINDER_WINDOW_MS);

    const reservations = await prisma.reservation.findMany({
      where: {
        status: ReservationStatus.CONFIRMED,
        startTime: {
          gte: windowStart,
          lt: windowEnd,
        },
        reminders: {
          none: { offsetMinutes, sentAt: { not: null } },
        },
      },
      select: {
        id: true,
        studentId: true,
      },
    });

    if (reservations.length === 0) continue;

    const rooms = await prisma.room.findMany({
      where: { studentId: { in: reservations.map((reservation) => reservation.studentId) } },
      select: {
        id: true,
        ownerId: true,
        studentId: true,
        channels: {
          where: { type: "BOOKING" },
          select: { id: true },
          take: 1,
        },
      },
    });
    const roomByStudentId = new Map(rooms.map((room) => [room.studentId, room]));

    for (const reservation of reservations) {
      const room = roomByStudentId.get(reservation.studentId);
      const bookingChannelId = room?.channels[0]?.id;
      if (!room || !bookingChannelId) continue;

      const reminder = await claimReminder(reservation.id, offsetMinutes, now);
      if (!reminder) continue;

      try {
        await sendAppNotification({
          userIds: [room.ownerId, room.studentId],
          kind: "lesson_reminder",
          title: reminderTitle(offsetMinutes),
          body: {
            ja: "予約チャンネルで時間と通話準備を確認できます。",
            en: "Open the booking channel to check the time and call setup.",
          },
          roomId: room.id,
          channelId: bookingChannelId,
          url: buildNotificationUrl(bookingChannelId),
          tag: `lesson-reminder:${reservation.id}:${offsetMinutes}`,
        }, { failOnPushError: true });
        await prisma.reservationReminder.update({
          where: { id: reminder.id },
          data: { sentAt: new Date(), lastError: null },
        });
      } catch (error) {
        const lastError = error instanceof Error && error.message === "PUSH_DELIVERY_FAILED"
          ? error.message
          : "REMINDER_SEND_FAILED";
        await prisma.reservationReminder.update({
          where: { id: reminder.id },
          data: { lastError },
        }).catch(() => undefined);
        console.error("[Notifications] レッスン前リマインダー送信失敗:", reservation.id, lastError);
      }
    }
  }
}
