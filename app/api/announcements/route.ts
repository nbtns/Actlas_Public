import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ANNOUNCEMENT_MAX_LENGTH,
  announcementNotificationPreview,
  emitAnnouncementUpdate,
  getAnnouncementInclude,
  requireAnnouncementUser,
  resolveAnnouncementAccess,
  serializeAnnouncement,
} from "@/lib/announcements";
import { wakeAnnouncementDeliveryWorker } from "@/lib/announcement-deliveries";

export async function GET(request: NextRequest) {
  const user = await requireAnnouncementUser(request);
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const access = await resolveAnnouncementAccess(user);
  if (!access) return NextResponse.json({ error: "ANNOUNCEMENT_ACCESS_REQUIRED" }, { status: 403 });
  const { teacherId, joinedAt } = access;

  const readCursor = user.role === "STUDENT"
    ? await prisma.announcementReadState.findUnique({
        where: { teacherId_userId: { teacherId, userId: user.userId } },
        select: { notifiedAt: true },
      })
    : null;

  const audienceWhere = {
    teacherId,
    ...(joinedAt ? { createdAt: { gte: joinedAt } } : {}),
  };

  const beforeId = request.nextUrl.searchParams.get("before");
  const anchor = beforeId
    ? await prisma.announcement.findFirst({
        where: { id: beforeId, ...audienceWhere },
        select: { id: true, createdAt: true },
      })
    : null;

  if (beforeId && !anchor) {
    return NextResponse.json({ error: "INVALID_CURSOR" }, { status: 400 });
  }

  const rows = await prisma.announcement.findMany({
    where: {
      ...audienceWhere,
      ...(anchor ? {
        OR: [
          { createdAt: { lt: anchor.createdAt } },
          { createdAt: anchor.createdAt, id: { lt: anchor.id } },
        ],
      } : {}),
    },
    include: getAnnouncementInclude(),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
  });
  const hasMore = rows.length > 50;
  const announcements = rows.slice(0, 50).map((row) => serializeAnnouncement(row, user));

  return NextResponse.json({
    announcements,
    hasMore,
    readCursor: readCursor?.notifiedAt.toISOString() ?? null,
  });
}

export async function POST(request: NextRequest) {
  const user = await requireAnnouncementUser(request);
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  if (user.role !== "TEACHER") {
    return NextResponse.json({ error: "TEACHER_ONLY" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "CONTENT_REQUIRED" }, { status: 400 });
  if (content.length > ANNOUNCEMENT_MAX_LENGTH) {
    return NextResponse.json({ error: "CONTENT_TOO_LONG" }, { status: 400 });
  }

  const preview = announcementNotificationPreview(content) || "先生から新しいお知らせが届きました。";
  const notifiedAt = new Date();
  const { announcement, studentIds } = await prisma.$transaction(async (tx) => {
    const created = await tx.announcement.create({
      data: { content, teacherId: user.userId },
      include: getAnnouncementInclude(),
    });
    const rooms = await tx.room.findMany({
      where: { ownerId: user.userId, createdAt: { lte: created.createdAt } },
      select: { studentId: true },
    });
    const recipients = rooms.map((room) => room.studentId);

    if (recipients.length > 0) {
      for (const studentId of recipients) {
        await tx.announcementReadState.upsert({
          where: { teacherId_userId: { teacherId: user.userId, userId: studentId } },
          create: { teacherId: user.userId, userId: studentId, notifiedAt },
          update: { notifiedAt },
        });
      }
      await tx.announcementDelivery.createMany({
        data: recipients.map((recipientId) => ({
          announcementId: created.id,
          recipientId,
          eventKind: "created",
          titleJa: "新しいお知らせ",
          titleEn: "New announcement",
          bodyJa: preview,
          bodyEn: announcementNotificationPreview(content) || "Your teacher posted a new announcement.",
          url: `/?view=announcements&announcement=${encodeURIComponent(created.id)}`,
          tag: `announcement:${created.id}`,
        })),
      });
    }

    return { announcement: created, studentIds: recipients };
  }, { isolationLevel: "Serializable" });

  emitAnnouncementUpdate([user.userId, ...studentIds], {
    announcementId: announcement.id,
    reason: "created",
  });

  if (studentIds.length > 0) wakeAnnouncementDeliveryWorker();

  return NextResponse.json(
    { announcement: serializeAnnouncement(announcement, user) },
    { status: 201 }
  );
}
