import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAnnouncementUser, resolveAnnouncementAccess } from "@/lib/announcements";

export async function POST(request: NextRequest) {
  const user = await requireAnnouncementUser(request);
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  if (user.role !== "STUDENT") return NextResponse.json({ success: true });

  const access = await resolveAnnouncementAccess(user);
  if (!access) return NextResponse.json({ error: "ANNOUNCEMENT_ACCESS_REQUIRED" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const cursorValue = typeof body.through === "string" ? body.through : "";
  const cursor = new Date(cursorValue);
  if (!cursorValue || Number.isNaN(cursor.getTime())) {
    return NextResponse.json({ error: "INVALID_READ_CURSOR" }, { status: 400 });
  }

  const state = await prisma.announcementReadState.findUnique({
    where: { teacherId_userId: { teacherId: access.teacherId, userId: user.userId } },
    select: { id: true, notifiedAt: true },
  });
  if (!state) return NextResponse.json({ success: true, readAt: null });

  const effectiveCursor = cursor > state.notifiedAt ? state.notifiedAt : cursor;
  await prisma.announcementReadState.updateMany({
    where: {
      id: state.id,
      OR: [
        { readAt: null },
        { readAt: { lt: effectiveCursor } },
      ],
    },
    data: { readAt: effectiveCursor },
  });
  return NextResponse.json({ success: true, readAt: effectiveCursor.toISOString() });
}
