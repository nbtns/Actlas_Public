import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'TEACHER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { studentId, menuId, amountPaid, targetDate } = await request.json();

    if (!studentId || !menuId || amountPaid === undefined || !targetDate) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const paidAmount = Number(amountPaid);
    if (!Number.isInteger(paidAmount) || paidAmount < 0) {
      return NextResponse.json({ error: 'Amount paid must be a whole USD amount' }, { status: 400 });
    }

    // 先生が担当している生徒か確認
    const room = await prisma.room.findFirst({
      where: { ownerId: payload.userId, studentId }
    });

    if (!room) {
      return NextResponse.json({ error: 'Student not found or not assigned to you' }, { status: 404 });
    }

    const menu = await prisma.lessonMenu.findFirst({
      where: { id: menuId, profile: { userId: payload.userId } },
      select: { duration: true }
    });

    if (!menu) {
      return NextResponse.json({ error: 'Menu not found' }, { status: 404 });
    }

    // 予約（Reservation）を作成してCOMPLETEDにする
    const startTime = new Date(targetDate);
    if (!Number.isFinite(startTime.getTime())) {
      return NextResponse.json({ error: 'Invalid target date' }, { status: 400 });
    }
    const endTime = new Date(startTime.getTime() + menu.duration * 60 * 1000);

    const newReservation = await prisma.reservation.create({
      data: {
        studentId,
        lessonMenuId: menuId,
        amountPaid: paidAmount,
        status: 'COMPLETED',
        startTime,
        endTime,
        notes: '手動追加'
      }
    });

    return NextResponse.json({ success: true, reservation: newReservation });

  } catch (error) {
    console.error('Manual Record API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'TEACHER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { menuId, month } = await request.json();
    if (!menuId || !month) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // 先生のメニューか確認
    const menu = await prisma.lessonMenu.findFirst({
      where: { id: menuId, profile: { userId: payload.userId } }
    });
    if (!menu) {
      return NextResponse.json({ error: 'Menu not found' }, { status: 404 });
    }

    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);
    const firstDayOfMonth = new Date(Date.UTC(year, monthNum - 1, 1));
    const lastDayOfMonth = new Date(Date.UTC(year, monthNum, 1));

    // その月の、そのメニューの、最新の完了済み予約を1件取得
    const latestReservation = await prisma.reservation.findFirst({
      where: {
        lessonMenuId: menuId,
        status: 'COMPLETED',
        startTime: {
          gte: firstDayOfMonth,
          lt: lastDayOfMonth
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!latestReservation) {
      return NextResponse.json({ error: '削除できるデータがありません' }, { status: 404 });
    }

    await prisma.reservation.delete({
      where: { id: latestReservation.id }
    });

    return NextResponse.json({ success: true, deletedId: latestReservation.id });

  } catch (error) {
    console.error('Manual Record Delete API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
