import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ANNOUNCEMENT_MAX_LENGTH,
  announcementNotificationPreview,
  emitAnnouncementUpdate,
  getAnnouncementAudienceIds,
  getAnnouncementInclude,
  requireAnnouncementUser,
  serializeAnnouncement,
} from "@/lib/announcements";
import { wakeAnnouncementDeliveryWorker } from "@/lib/announcement-deliveries";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await requireAnnouncementUser(request);
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  if (user.role !== "TEACHER") return NextResponse.json({ error: "TEACHER_ONLY" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "CONTENT_REQUIRED" }, { status: 400 });
  if (content.length > ANNOUNCEMENT_MAX_LENGTH) {
    return NextResponse.json({ error: "CONTENT_TOO_LONG" }, { status: 400 });
  }

  const notifiedAt = new Date();
  const preview = announcementNotificationPreview(content);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.announcement.findFirst({
      where: { id, teacherId: user.userId },
      select: { id: true, content: true, createdAt: true },
    });
    if (!existing) return null;

    if (existing.content === content) {
      const unchanged = await tx.announcement.findUniqueOrThrow({
        where: { id },
        include: getAnnouncementInclude(),
      });
      return { announcement: unchanged, studentIds: [] as string[], changed: false };
    }

    const updated = await tx.announcement.update({
      where: { id },
      data: { content },
      include: getAnnouncementInclude(),
    });
    const rooms = await tx.room.findMany({
      where: { ownerId: user.userId, createdAt: { lte: existing.createdAt } },
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
          announcementId: updated.id,
          recipientId,
          eventKind: "updated",
          titleJa: "お知らせが更新されました",
          titleEn: "Announcement updated",
          bodyJa: preview || "先生がお知らせを更新しました。",
          bodyEn: preview || "Your teacher updated an announcement.",
          url: `/?view=announcements&announcement=${encodeURIComponent(updated.id)}`,
          tag: `announcement:${updated.id}`,
        })),
      });
    }

    return { announcement: updated, studentIds: recipients, changed: true };
  }, { isolationLevel: "Serializable" });

  if (!result) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (result.changed) {
    emitAnnouncementUpdate([user.userId, ...result.studentIds], { announcementId: id, reason: "updated" });
    if (result.studentIds.length > 0) wakeAnnouncementDeliveryWorker();
  }

  return NextResponse.json({ announcement: serializeAnnouncement(result.announcement, user) });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await requireAnnouncementUser(request);
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  if (user.role !== "TEACHER") return NextResponse.json({ error: "TEACHER_ONLY" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.announcement.findFirst({
    where: { id, teacherId: user.userId },
    select: { id: true, createdAt: true },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const studentIds = await getAnnouncementAudienceIds(user.userId, existing.createdAt);
  await prisma.announcement.delete({ where: { id } });
  emitAnnouncementUpdate([user.userId, ...studentIds], { announcementId: id, reason: "deleted" });
  return NextResponse.json({ success: true });
}
