import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function PUT(request: NextRequest) {
  try {
    const token = request.cookies.get("token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const profile = await prisma.teacherProfile.findUnique({
      where: { userId: payload.userId },
    });

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const body = await request.json();
    const menuIds = body.menuIds;

    if (!Array.isArray(menuIds) || !menuIds.every((id) => typeof id === "string")) {
      return NextResponse.json({ error: "menuIds must be an array of menu IDs" }, { status: 400 });
    }

    if (new Set(menuIds).size !== menuIds.length) {
      return NextResponse.json({ error: "Duplicate menu IDs are not allowed" }, { status: 400 });
    }

    const existingMenus = await prisma.lessonMenu.findMany({
      where: { profileId: profile.id },
      select: { id: true },
    });
    const existingIds = new Set(existingMenus.map((menu) => menu.id));

    if (menuIds.length !== existingIds.size || !menuIds.every((id) => existingIds.has(id))) {
      return NextResponse.json({ error: "Menu list does not match this profile" }, { status: 400 });
    }

    await prisma.$transaction(
      menuIds.map((id, index) =>
        prisma.lessonMenu.update({
          where: { id },
          data: { displayOrder: index },
        })
      )
    );

    const menus = await prisma.lessonMenu.findMany({
      where: { profileId: profile.id },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({ menus });
  } catch (error) {
    console.error("Failed to reorder menus:", error);
    return NextResponse.json({ error: "Failed to reorder menus" }, { status: 500 });
  }
}
