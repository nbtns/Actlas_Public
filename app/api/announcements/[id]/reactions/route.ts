import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAnnouncementReactionEmoji } from "@/lib/announcement-shared";
import {
  emitAnnouncementUpdate,
  getAnnouncementAudienceIds,
  requireAnnouncementUser,
  resolveAnnouncementAccess,
} from "@/lib/announcements";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await requireAnnouncementUser(request);
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  if (user.role !== "STUDENT") return NextResponse.json({ error: "STUDENT_ONLY" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (!isAnnouncementReactionEmoji(body.emoji)) {
    return NextResponse.json({ error: "INVALID_EMOJI" }, { status: 400 });
  }

  const access = await resolveAnnouncementAccess(user);
  if (!access || !access.joinedAt) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const announcement = await prisma.announcement.findFirst({
    where: {
      id,
      teacherId: access.teacherId,
      createdAt: { gte: access.joinedAt },
    },
    select: { id: true, teacherId: true, createdAt: true },
  });
  if (!announcement) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const key = {
    announcementId_studentId_emoji: {
      announcementId: id,
      studentId: user.userId,
      emoji: body.emoji,
    },
  };
  const existing = await prisma.announcementReaction.findUnique({
    where: key,
    select: { id: true },
  });

  if (existing) {
    await prisma.announcementReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.announcementReaction.create({
      data: { announcementId: id, studentId: user.userId, emoji: body.emoji },
    });
  }

  const studentIds = await getAnnouncementAudienceIds(announcement.teacherId, announcement.createdAt);
  emitAnnouncementUpdate([announcement.teacherId, ...studentIds], {
    announcementId: id,
    reason: "reaction",
  });

  return NextResponse.json({ active: !existing });
}
