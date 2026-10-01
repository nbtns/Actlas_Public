import { ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildNotificationUrl, sendAppNotification } from "@/lib/notifications";
import { getRealtimeServer } from "@/lib/realtime";
import { buildReservationSystemMessage } from "@/lib/reservation-messages";

export type ReservationRoomTarget = {
  id: string;
  ownerId: string;
  studentId: string;
};

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

export async function emitReservationUpdated(
  room: ReservationRoomTarget,
  action: "created" | "cancelled",
  reservationId: string
) {
  const io = getRealtimeServer();
  if (io) {
    io.to(`user:${room.ownerId}`)
      .to(`user:${room.studentId}`)
      .emit("rooms_updated", { roomId: room.id, reason: "reservation" });
    io.to(`user:${room.ownerId}`)
      .to(`user:${room.studentId}`)
      .emit("schedule_updated", {
        type: "reservation",
        action,
        roomId: room.id,
        studentId: room.studentId,
        reservationId,
      });

    const teacherRooms = await prisma.room.findMany({
      where: { ownerId: room.ownerId },
      select: { studentId: true },
    });
    teacherRooms
      .filter((teacherRoom) => teacherRoom.studentId !== room.studentId)
      .forEach((teacherRoom) => {
        io.to(`user:${teacherRoom.studentId}`).emit("schedule_updated", {
          type: "reservation-availability",
          action: "changed",
        });
      });
  }

  await notifyReservationChange(room, reservationId);
}

async function notifyReservationChange(room: ReservationRoomTarget, reservationId: string) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      status: true,
    },
  });
  if (!reservation || reservation.status === ReservationStatus.PENDING || reservation.status === ReservationStatus.COMPLETED) {
    return;
  }

  const bookingChannel = await prisma.channel.findFirst({
    where: { roomId: room.id, type: "BOOKING" },
    select: { id: true },
  });
  if (!bookingChannel) return;

  let text: { title: { ja: string; en: string }; body: { ja: string; en: string } } | null = null;
  if (reservation.status === ReservationStatus.CONFIRMED) {
    text = {
      title: { ja: "予約が確定しました", en: "Reservation confirmed" },
      body: { ja: "予約チャンネルで日時を確認できます。", en: "Open the booking channel to check the date and time." },
    };
  } else if (reservation.status === ReservationStatus.CANCELLED) {
    text = {
      title: { ja: "予約がキャンセルされました", en: "Reservation canceled" },
      body: { ja: "予約チャンネルで変更内容を確認できます。", en: "Open the booking channel to check the update." },
    };
  } else if (reservation.status === ReservationStatus.REFUNDED) {
    text = {
      title: { ja: "返金手続きを開始しました", en: "Refund started" },
      body: { ja: "予約チャンネルで返金の案内を確認できます。", en: "Open the booking channel to check the refund notice." },
    };
  }
  if (!text) return;

  await sendAppNotification({
    userIds: [room.ownerId, room.studentId],
    kind: "reservation",
    title: text.title,
    body: text.body,
    roomId: room.id,
    channelId: bookingChannel.id,
    url: buildNotificationUrl(bookingChannel.id),
    tag: `reservation:${reservationId}:${reservation.status}`,
  });
}

export async function postReservationConfirmedMessage(input: {
  studentId: string;
  start: Date;
  end: Date;
  notes?: string | null;
  isTeacherCreated: boolean;
}) {
  const room = await prisma.room.findFirst({
    where: { studentId: input.studentId },
    include: {
      channels: {
        where: { type: "CHAT" },
        select: { id: true },
      },
    },
  });

  if (!room || room.channels.length === 0) return room;

  const teacher = await prisma.user.findFirst({
    where: { id: room.ownerId },
    select: { id: true },
  });
  if (!teacher) return room;

  const chatChannel = room.channels[0];
  const message = await prisma.message.create({
    data: {
      content: buildReservationSystemMessage({
        type: input.isTeacherCreated ? "reservation_added_by_teacher" : "reservation_confirmed",
        start: input.start,
        end: input.end,
        notes: input.notes,
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

  return room;
}
