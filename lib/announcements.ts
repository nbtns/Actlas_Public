import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { AUTH_COOKIE, verifyToken, type JwtPayload } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRealtimeServer } from "@/lib/realtime";
import type { AnnouncementUpdatedPayload } from "@/lib/announcement-shared";

export const ANNOUNCEMENT_MAX_LENGTH = 10_000;

const announcementInclude = {
  teacher: {
    select: { id: true, name: true, avatarUrl: true },
  },
  reactions: {
    orderBy: { createdAt: "asc" },
    select: {
      emoji: true,
      studentId: true,
      student: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.AnnouncementInclude;

export type AnnouncementWithRelations = Prisma.AnnouncementGetPayload<{
  include: typeof announcementInclude;
}>;

export async function requireAnnouncementUser(request: NextRequest): Promise<JwtPayload | null> {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export type AnnouncementAccess = {
  teacherId: string;
  joinedAt: Date | null;
};

export async function resolveAnnouncementAccess(user: JwtPayload): Promise<AnnouncementAccess | null> {
  if (user.role === "TEACHER") return { teacherId: user.userId, joinedAt: null };

  const room = await prisma.room.findUnique({
    where: { studentId: user.userId },
    select: { ownerId: true, createdAt: true },
  });
  return room ? { teacherId: room.ownerId, joinedAt: room.createdAt } : null;
}

export async function resolveAnnouncementTeacherId(user: JwtPayload): Promise<string | null> {
  const access = await resolveAnnouncementAccess(user);
  return access?.teacherId ?? null;
}

export async function getAnnouncementAudienceIds(
  teacherId: string,
  announcementCreatedAt?: Date
): Promise<string[]> {
  const rooms = await prisma.room.findMany({
    where: {
      ownerId: teacherId,
      ...(announcementCreatedAt ? { createdAt: { lte: announcementCreatedAt } } : {}),
    },
    select: { studentId: true },
  });
  return rooms.map((room) => room.studentId);
}

export function getAnnouncementInclude() {
  return announcementInclude;
}

export function serializeAnnouncement(
  announcement: AnnouncementWithRelations,
  viewer: JwtPayload
) {
  const grouped = new Map<string, { emoji: string; count: number; students: { id: string; name: string }[] }>();
  const currentUserEmojis: string[] = [];

  for (const reaction of announcement.reactions) {
    const group = grouped.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, students: [] };
    group.count += 1;
    if (viewer.role === "TEACHER") group.students.push(reaction.student);
    grouped.set(reaction.emoji, group);
    if (reaction.studentId === viewer.userId) currentUserEmojis.push(reaction.emoji);
  }

  return {
    id: announcement.id,
    content: announcement.content,
    createdAt: announcement.createdAt.toISOString(),
    updatedAt: announcement.updatedAt.toISOString(),
    isEdited: announcement.updatedAt.getTime() !== announcement.createdAt.getTime(),
    teacher: announcement.teacher,
    reactions: Array.from(grouped.values()),
    currentUserEmojis,
  };
}

export function emitAnnouncementUpdate(
  userIds: string[],
  payload: AnnouncementUpdatedPayload
): void {
  const io = getRealtimeServer();
  if (!io) return;
  for (const userId of new Set(userIds)) {
    io.to(`user:${userId}`).emit("announcements_updated", payload);
  }
}

export function announcementNotificationPreview(content: string): string {
  const plain = content
    .replace(/^\s*(?:#{1,3}|-#)\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/g, "$1")
    .replace(/^\s*-\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 120 ? `${plain.slice(0, 117)}...` : plain;
}
