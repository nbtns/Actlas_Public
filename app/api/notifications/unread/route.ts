import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAnnouncementTeacherId } from "@/lib/announcements";

async function requireUser(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const states = await prisma.notificationChannelState.findMany({
    where: { userId: user.userId },
    select: { channelId: true, notifiedAt: true, readAt: true },
  });
  const channelIds = states
    .filter((state) => !state.readAt || state.notifiedAt > state.readAt)
    .map((state) => state.channelId);

  let announcementUnread = false;
  if (user.role === "STUDENT") {
    const teacherId = await resolveAnnouncementTeacherId(user);
    if (teacherId) {
      const readState = await prisma.announcementReadState.findUnique({
        where: { teacherId_userId: { teacherId, userId: user.userId } },
        select: { notifiedAt: true, readAt: true },
      });
      announcementUnread = Boolean(
        readState && (!readState.readAt || readState.notifiedAt > readState.readAt)
      );
    }
  }

  return NextResponse.json({ channelIds, announcementUnread });
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  if (!channelId) return NextResponse.json({ error: "INVALID_CHANNEL" }, { status: 400 });

  const channel = await prisma.channel.findFirst({
    where: {
      id: channelId,
      OR: [
        { room: { ownerId: user.userId } },
        { room: { studentId: user.userId }, teacherOnly: false },
      ],
    },
    select: { id: true },
  });
  if (!channel) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  await prisma.notificationChannelState.updateMany({
    where: { userId: user.userId, channelId },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ success: true });
}
