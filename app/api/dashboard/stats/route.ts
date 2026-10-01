import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
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

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { email: true, name: true }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get('month');

    const now = new Date();
    let targetYear = now.getFullYear();
    let targetMonth = now.getMonth();
    
    if (monthParam) {
      const parts = monthParam.split('-');
      if (parts.length === 2) {
        targetYear = parseInt(parts[0], 10);
        targetMonth = parseInt(parts[1], 10) - 1;
      }
    }
    
    const firstDayOfMonth = new Date(targetYear, targetMonth, 1);
    const lastDayOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);

    const teacherId = payload.userId;
    const rooms = await prisma.room.findMany({ 
      where: { ownerId: teacherId }, 
      select: { studentId: true, student: { select: { id: true, name: true } } } 
    });
    const students = rooms.map(r => ({ id: r.student.id, name: r.student.name }));
    const studentIds = students.map(s => s.id);
    
    const teacherProfile = await prisma.teacherProfile.findUnique({
      where: { userId: teacherId },
      include: { menus: { orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] } }
    });
    const menus = teacherProfile ? teacherProfile.menus.map(m => ({ id: m.id, name: m.name, price: m.price })) : [];
    
    let totalSales = 0;
    let totalDuration = 0;
    let lessonCount = 0;
    let menuStats: { id: string; name: string; count: number; sales: number }[] = [];
    let availableMonths: string[] = [];

    // Ensure current month is always available
    const currentYearStr = now.getFullYear();
    const currentMonthStr = String(now.getMonth() + 1).padStart(2, '0');
    const monthsSet = new Set<string>([`${currentYearStr}-${currentMonthStr}`]);

    if (studentIds.length > 0) {
      // 過去月のリスト作成（すべての予約を対象にする）
      const allReservations = await prisma.reservation.findMany({
        where: { studentId: { in: studentIds } },
        select: { startTime: true },
        orderBy: { startTime: 'desc' }
      });
      
      allReservations.forEach(res => {
        const y = res.startTime.getFullYear();
        const m = String(res.startTime.getMonth() + 1).padStart(2, '0');
        monthsSet.add(`${y}-${m}`);
      });

      // 指定月の集計
      const reservations = await prisma.reservation.findMany({
        where: {
          studentId: { in: studentIds },
          status: 'COMPLETED',
          startTime: { gte: firstDayOfMonth, lte: lastDayOfMonth }
        },
        include: {
          lessonMenu: true
        }
      });
      totalSales = reservations.reduce((sum, res) => sum + (res.amountPaid || 0), 0);
      lessonCount = reservations.length;

      // メニュー別集計
      const menuMap = new Map<string, { id: string, name: string, count: number, sales: number }>();
      reservations.forEach(res => {
        const menu = res.lessonMenu;
        if (menu) {
          const existing = menuMap.get(menu.id) || { id: menu.id, name: menu.name, count: 0, sales: 0 };
          existing.count += 1;
          existing.sales += (res.amountPaid || 0);
          menuMap.set(menu.id, existing);
        } else {
          // メニューなし（削除済み等）の場合
          const noMenuId = 'unknown';
          const existing = menuMap.get(noMenuId) || { id: noMenuId, name: 'メニューなし', count: 0, sales: 0 };
          existing.count += 1;
          existing.sales += (res.amountPaid || 0);
          menuMap.set(noMenuId, existing);
        }
      });
      menuStats = Array.from(menuMap.values());

      const lessonRecords = await prisma.lessonRecord.findMany({
        where: {
          reservation: { studentId: { in: studentIds } },
          createdAt: { gte: firstDayOfMonth, lte: lastDayOfMonth }
        }
      });
      totalDuration = lessonRecords.reduce((sum, rec) => sum + (rec.duration || 0), 0);
    }
    
    availableMonths = Array.from(monthsSet).sort((a, b) => b.localeCompare(a)); // 降順
    
    // API利用料は gpt-realtime-translate ($0.034/min) 等のコストに基づいてレッスン1回あたり$2.30換算
    const apiCost = lessonCount * 2.30;

    const configuredFeeRate = Number(
      process.env.STRIPE_APPLICATION_FEE_PERCENT || process.env.SYSTEM_FEE_RATE || '15'
    );
    const systemFeeRate = Number.isFinite(configuredFeeRate) ? configuredFeeRate : 15;

    return NextResponse.json({
      stats: [{
        id: teacherId,
        name: user.name,
        email: user.email,
        totalSales,
        totalDuration,
        apiCost,
        studentCount: studentIds.length,
        lessonCount,
        systemFeeRate,
        menuStats,
        availableMonths,
        students,
        menus
      }]
    });

  } catch (error) {
    console.error('Stats API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
