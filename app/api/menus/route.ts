import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";
import { getReservationErrorMessage, type ReservationErrorCode } from "@/lib/reservation-messages";

function menuErrorResponse(errorCode: ReservationErrorCode, status: number) {
  return NextResponse.json(
    { errorCode, error: getReservationErrorMessage(errorCode, "ja") },
    { status }
  );
}

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) return menuErrorResponse("AUTH_REQUIRED", 401);

    const payload = await verifyToken(token);
    if (!payload) return menuErrorResponse("AUTH_INVALID", 401);

    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get("roomId");

    let teacherId: string | undefined;
    let targetStudentId: string | undefined;

    if (roomId) {
      // ルームのオーナー（先生）を取得
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { ownerId: true, studentId: true },
      });
      if (!room) {
        return NextResponse.json({ menus: [] });
      }
      if (payload.role === "STUDENT" && room.studentId !== payload.userId) {
        return menuErrorResponse("FORBIDDEN", 403);
      }
      if (payload.role === "TEACHER" && room.ownerId !== payload.userId) {
        return menuErrorResponse("FORBIDDEN", 403);
      }
      teacherId = room.ownerId;
      targetStudentId = room.studentId;
    }

    if (!teacherId) {
      if (payload.role === "TEACHER") {
        teacherId = payload.userId;
      } else {
        const room = await prisma.room.findUnique({
          where: { studentId: payload.userId },
          select: { ownerId: true, studentId: true },
        });
        if (room) {
          teacherId = room.ownerId;
          targetStudentId = room.studentId;
        }
      }
    }

    if (!teacherId) {
      return NextResponse.json({ menus: [] });
    }

    const specialOfferEligible = targetStudentId
      ? (await prisma.user.findUnique({
          where: { id: targetStudentId },
          select: { specialOfferEligible: true },
        }))?.specialOfferEligible === true
      : payload.role === "TEACHER";

    const profile = await prisma.teacherProfile.findUnique({
      where: { userId: teacherId },
      include: {
        menus: {
          orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (!profile) {
      return NextResponse.json({ menus: [] });
    }

    const menus = profile.menus.map((menu) => {
      const specialPriceApplied = specialOfferEligible && menu.specialPrice !== null;
      const visibleMenu = {
        id: menu.id,
        name: menu.name,
        description: menu.description,
        duration: menu.duration,
        createdAt: menu.createdAt,
        updatedAt: menu.updatedAt,
        profileId: menu.profileId,
        displayOrder: menu.displayOrder,
        standardPrice: menu.price,
        price: specialPriceApplied ? menu.specialPrice : menu.price,
        specialPriceApplied,
      };
      if (payload.role === "TEACHER") {
        return { ...visibleMenu, specialPrice: menu.specialPrice };
      }
      return visibleMenu;
    });

    return NextResponse.json({ menus });
  } catch (error) {
    console.error("Failed to fetch menus:", error);
    return menuErrorResponse("MENUS_FETCH_FAILED", 500);
  }
}
