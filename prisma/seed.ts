import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertDemoDatabaseUrl } from "../scripts/demo-environment.mjs";

assertDemoDatabaseUrl();
const prisma = new PrismaClient();

async function main() {
  const password = process.env.DEMO_ACCOUNT_PASSWORD;
  if (!password || password.length < 16) {
    throw new Error("DEMO_ACCOUNT_PASSWORD は16文字以上にしてください。npm run demo:setup で生成できます。");
  }
  const hash = await bcrypt.hash(password, 10);
  const teacher = await prisma.user.upsert({
    where: { email: "teacher@example.com" },
    update: {},
    create: {
      id: "demo-teacher",
      email: "teacher@example.com",
      password: hash,
      name: "デモ先生",
      role: "TEACHER",
      isFirstLogin: false,
      notificationsEnabled: false,
    },
  });
  const profile = await prisma.teacherProfile.upsert({
    where: { userId: teacher.id },
    update: {},
    create: {
      id: "demo-profile",
      userId: teacher.id,
      username: "demo-teacher",
      title: "オンラインレッスンのデモ",
      bio: "架空の先生プロフィールです。レッスンと会話、教材、予約をひとつの画面で管理します。",
    },
  });
  const menu = await prisma.lessonMenu.upsert({
    where: { id: "demo-free-lesson" },
    update: {},
    create: {
      id: "demo-free-lesson",
      profileId: profile.id,
      name: "無料デモレッスン",
      description: "決済なしで予約の流れを確認するための架空メニューです。",
      price: 0,
      duration: 30,
    },
  });
  for (const index of [1, 2]) {
    const student = await prisma.user.upsert({
      where: { email: `student${index}@example.com` },
      update: {},
      create: {
        id: `demo-student-${index}`,
        email: `student${index}@example.com`,
        password: hash,
        name: `デモ生徒${index}`,
        role: "STUDENT",
        isFirstLogin: false,
        notificationsEnabled: false,
        goals: "レッスンを継続し、練習内容を振り返る",
      },
    });
    const room = await prisma.room.upsert({
      where: { studentId: student.id },
      update: {},
      create: {
        id: `demo-room-${index}`,
        ownerId: teacher.id,
        studentId: student.id,
        name: `デモ生徒${index}のルーム`,
        lastMessage: "次回は前回の練習内容を確認しましょう。",
        lastMessageAt: new Date(),
      },
    });
    const channels = [
      ["GUIDE", "使い方ガイド", false],
      ["CHAT", "チャット", false],
      ["MATERIAL", "教材", false],
      ["BOOKING", "予約", false],
      ["YOUTUBE", "同時視聴", false],
      ["MEMO", "メモ", false],
      ["LESSON_RECORD", "レッスン記録", true],
      ["DASHBOARD", "ダッシュボード", true],
    ] as const;
    for (const [position, [type, name, teacherOnly]] of channels.entries()) {
      const channel = await prisma.channel.upsert({
        where: { id: `demo-channel-${index}-${type.toLowerCase()}` },
        update: {},
        create: {
          id: `demo-channel-${index}-${type.toLowerCase()}`,
          roomId: room.id, name, type, position: position + 1, teacherOnly,
        },
      });
      if (type === "CHAT") {
        await prisma.message.upsert({
          where: { id: `demo-message-${index}-1` },
          update: {},
          create: { id: `demo-message-${index}-1`, channelId: channel.id, authorId: student.id,
            content: "こんにちは。次回のレッスンで練習の進め方を相談したいです。" },
        });
        await prisma.message.upsert({
          where: { id: `demo-message-${index}-2` },
          update: {},
          create: { id: `demo-message-${index}-2`, channelId: channel.id, authorId: teacher.id,
            content: "次回は前回の練習内容を確認しましょう。" },
        });
      }
      if (type === "LESSON_RECORD") {
        await prisma.message.upsert({
          where: { id: `demo-record-${index}` },
          update: {},
          create: { id: `demo-record-${index}`, channelId: channel.id, authorId: teacher.id,
            content: "【手書きのデモ記録】\n練習内容を確認し、次回までの課題を整理しました。\n本来は翻訳字幕ログからAI要約を作成できます。公開版ではAI生成を停止しています。",
            isSystem: true },
        });
      }
    }
    await prisma.reservation.upsert({
      where: { id: `demo-reservation-${index}` },
      update: {},
      create: {
        id: `demo-reservation-${index}`,
        studentId: student.id,
        lessonMenuId: menu.id,
        startTime: new Date(Date.now() + (index + 1) * 86400000),
        endTime: new Date(Date.now() + (index + 1) * 86400000 + 1800000),
        status: "CONFIRMED",
        notes: "架空の予約です。",
      },
    });
  }
  console.log("架空の先生1名・生徒2名、チャンネル、会話、無料メニュー、予約を用意しました。");
  console.log("既存データやパスワードは上書きしていません。");
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "デモデータの作成に失敗しました。");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
