import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const isUploadedPhotoUrl = (url: string | null) => {
  if (!url) return false;
  return url.startsWith("/uploads/avatars/") || url.startsWith("/api/avatars/") || url.startsWith("http");
};

export async function GET() {
  try {
    // シングルテナント構成のため、最初の1件のプロフィールを取得
    const profile = await prisma.teacherProfile.findFirst({
      select: {
        id: true,
        username: true,
        title: true,
        bio: true,
        photoUrl: true,
        photoPositionX: true,
        photoPositionY: true,
        photoZoom: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            name: true,
            avatarUrl: true,
          }
        },
        menus: {
          orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            duration: true,
          },
        },
        commercialLaw: true,
      }
    });

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const { user, ...profileData } = profile;
    const photoUrl = profile.photoUrl || (isUploadedPhotoUrl(user.avatarUrl) ? user.avatarUrl : null);

    return NextResponse.json({
      profile: {
        ...profileData,
        photoUrl,
        user: {
          name: user.name,
        },
      },
    });
  } catch (error) {
    console.error("Failed to fetch public profile:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
