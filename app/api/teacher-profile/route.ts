import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { verifyToken } from "@/lib/auth";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("token")?.value;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized or not a teacher" }, { status: 401 });
    }

    const profile = await prisma.teacherProfile.findUnique({
      where: { userId: payload.userId },
      include: {
        menus: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] },
        commercialLaw: true,
        user: { select: { avatarUrl: true } },
      },
    });

    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Failed to fetch teacher profile:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("token")?.value;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "TEACHER") {
      return NextResponse.json({ error: "Unauthorized or not a teacher" }, { status: 401 });
    }

    const data = await request.json();
    const { title, bio, photoUrl, photoPositionX, photoPositionY, photoZoom, commercialLaw } = data;
    const clampNumber = (value: unknown, min: number, max: number) => {
      const numberValue = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(numberValue)) return min;
      return Math.min(max, Math.max(min, Math.round(numberValue)));
    };

    // Prismaに渡してはいけないフィールドを除外
    const getCleanLawData = <T>(law: unknown): T => {
      if (!law || typeof law !== "object") return {} as T;
      const { id: _id, profileId: _profileId, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = law as Record<string, unknown>;
      return rest as T;
    };

    // 既存のプロフィールを確認
    const existingProfile = await prisma.teacherProfile.findUnique({
      where: { userId: payload.userId },
    });

    const shouldUpdateCommercialLaw = Object.prototype.hasOwnProperty.call(data, "commercialLaw");
    let profile;

    if (existingProfile) {
      // 更新 (usernameは既存のものを維持)
      const profileData: Prisma.TeacherProfileUpdateInput = {};
      if (title !== undefined) profileData.title = title;
      if (bio !== undefined) profileData.bio = bio;
      if (photoUrl !== undefined) profileData.photoUrl = photoUrl || null;
      if (photoPositionX !== undefined) profileData.photoPositionX = clampNumber(photoPositionX, 0, 100);
      if (photoPositionY !== undefined) profileData.photoPositionY = clampNumber(photoPositionY, 0, 100);
      if (photoZoom !== undefined) profileData.photoZoom = clampNumber(photoZoom, 100, 250);
      if (shouldUpdateCommercialLaw) {
        profileData.commercialLaw = commercialLaw ? {
          upsert: {
            create: getCleanLawData<Prisma.CommercialLawInfoUncheckedCreateWithoutProfileInput>(commercialLaw),
            update: getCleanLawData<Prisma.CommercialLawInfoUncheckedUpdateWithoutProfileInput>(commercialLaw),
          }
        } : {
          delete: true
        };
      }

      profile = await prisma.teacherProfile.update({
        where: { userId: payload.userId },
        data: profileData,
        include: {
          menus: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] },
          commercialLaw: true,
        },
      });
    } else {
      // 新規作成時はランダムな5桁の数字を自動生成
      let finalUsername = "";
      let isUnique = false;
      while (!isUnique) {
        finalUsername = Math.floor(10000 + Math.random() * 90000).toString();
        const check = await prisma.teacherProfile.findUnique({ where: { username: finalUsername } });
        if (!check) isUnique = true;
      }

      // 新規作成
      profile = await prisma.teacherProfile.create({
        data: {
          userId: payload.userId,
          username: finalUsername,
          title,
          bio,
          photoUrl: photoUrl || null,
          photoPositionX: photoPositionX !== undefined ? clampNumber(photoPositionX, 0, 100) : 50,
          photoPositionY: photoPositionY !== undefined ? clampNumber(photoPositionY, 0, 100) : 50,
          photoZoom: photoZoom !== undefined ? clampNumber(photoZoom, 100, 250) : 100,

          commercialLaw: commercialLaw ? {
            create: getCleanLawData<Prisma.CommercialLawInfoUncheckedCreateWithoutProfileInput>(commercialLaw),
          } : undefined,
        },
        include: {
          menus: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] },
          commercialLaw: true,
        },
      });
    }

    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Failed to update teacher profile:", error);
    // Unique constraint error for username
    if (error instanceof Error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
