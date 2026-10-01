/**
 * Actlas カスタムサーバー
 * Next.js + Socket.IO を1つのHTTPサーバーで統合
 * チャットメッセージのリアルタイム送受信を処理する
 */

import { createServer } from "http";
import { createReadStream, existsSync } from "fs";
import { join } from "path";
import { parse } from "url";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { jwtVerify } from "jose";
import dotenv from "dotenv";
import { AI_DISABLED_MESSAGE } from "./lib/public-demo";
import { assertDemoDatabaseUrl } from "./scripts/demo-environment.mjs";
import { setRealtimeServer } from "./lib/realtime";
import { sendUpcomingLessonReminders } from "./lib/lesson-reminders";
import { buildNotificationUrl, sendAppNotification } from "./lib/notifications";
import { processPendingAnnouncementDeliveries } from "./lib/announcement-deliveries";

dotenv.config();
assertDemoDatabaseUrl();

// 環境設定
const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

// Next.jsアプリの初期化
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Prismaクライアント（サーバー用のシングルトン）
const prisma = new PrismaClient();

// グローバルにSocket.IOインスタンスを保持するための変数
let globalIo: SocketIOServer | null = null;
let lessonReminderTimer: NodeJS.Timeout | null = null;
let announcementDeliveryTimer: NodeJS.Timeout | null = null;

// 通話ルームの管理（ルームID → 参加中のSocket IDセット）
const callRooms = new Map<string, Set<string>>();

const TRANSLATION_LANGUAGES = new Set([
  "en", "es", "fr", "de", "pt", "zh", "ko", "it", "ru", "ar", "hi", "nl", "ja",
]);

function startLessonReminderWorker() {
  if (lessonReminderTimer) return;

  const run = async () => {
    try {
      await sendUpcomingLessonReminders();
    } catch (error) {
      console.error("[Notifications] レッスン前リマインダー送信エラー:", error);
    }
  };

  lessonReminderTimer = setInterval(run, 60 * 1000);
  lessonReminderTimer.unref?.();
  run();
}

function startAnnouncementDeliveryWorker() {
  if (announcementDeliveryTimer) return;

  const run = async () => {
    try {
      await processPendingAnnouncementDeliveries();
    } catch (error) {
      console.error("[Announcements] 通知再試行ワーカーエラー:", error);
    }
  };

  announcementDeliveryTimer = setInterval(run, 60 * 1000);
  announcementDeliveryTimer.unref?.();
  run();
}

// JWT検証用のシークレットキー
const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
};

/**
 * cookieヘッダーからJWTトークンを抽出して検証する
 */
async function authenticateSocket(cookieHeader: string | undefined) {
  if (!cookieHeader) return null;

  // cookieヘッダーから "token=xxx" を探す
  const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
  if (!tokenMatch) return null;

  try {
    const { payload } = await jwtVerify(tokenMatch[1], getJwtSecretKey());
    const userId = payload.userId as string;
    const role = payload.role as "TEACHER" | "STUDENT";
    const sessionVersion = payload.sessionVersion;

    if (
      !userId ||
      (role !== "TEACHER" && role !== "STUDENT") ||
      typeof sessionVersion !== "number"
    ) {
      return null;
    }

    // DBからユーザー情報を取得
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, sessionVersion: true },
    });

    if (!user || user.role !== role || user.sessionVersion !== sessionVersion) return null;
    return { ...user, role: role };
  } catch {
    return null;
  }
}

app.prepare().then(async () => {
  // 自動マイグレーション：すべてのルームに同時視聴（YOUTUBE）チャンネルが存在するか確認し、なければ追加する
  try {
    const rooms = await prisma.room.findMany({ include: { channels: true } });
    for (const room of rooms) {
      if (!room.channels.some(c => c.type === 'YOUTUBE')) {
        await prisma.channel.create({
          data: {
            roomId: room.id,
            name: '同時視聴',
            type: 'YOUTUBE',
            position: 5,
            teacherOnly: false
          }
        });
        console.log(`[Auto-Migration] Added YOUTUBE channel to room: ${room.name}`);
      }
    }
  } catch (err) {
    console.error('[Auto-Migration] Error adding YOUTUBE channels:', err);
  }

  // HTTPサーバーを作成
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    // 公開評価版では、設定値に関係なく外部連携へ到達させない。
    if (
      ['/api/translate-session', '/api/translate-text', '/api/summarize'].includes(parsedUrl.pathname || '') ||
      parsedUrl.pathname?.startsWith('/api/stripe/')
    ) {
      res.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        code: 'PUBLIC_DEMO_FEATURE_DISABLED',
        error: parsedUrl.pathname?.startsWith('/api/stripe/')
          ? '公開デモでは決済連携を停止しています。無料メニューの予約をお試しください。'
          : AI_DISABLED_MESSAGE,
      }));
      return;
    }

    // ===== アバター画像の配信 (動的生成ファイル用) =====
    if (parsedUrl.pathname?.startsWith('/uploads/avatars/') && req.method === 'GET') {
      // process.cwd() / public / uploads / avatars / filename
      const filename = parsedUrl.pathname.split('/').pop() || '';
      const safeFilename = filename.replace(/[\/\\]/g, '').replace(/\.\./g, '');
      const filePath = join(process.cwd(), 'public', 'uploads', 'avatars', safeFilename);
      if (existsSync(filePath)) {
        const ext = filePath.split('.').pop()?.toLowerCase();
        const mimeTypes: Record<string, string> = {
          'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
          'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml'
        };
        res.writeHead(200, {
          'Content-Type': mimeTypes[ext || ''] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400'
        });
        createReadStream(filePath).pipe(res);
        return;
      }
    }

    // ===== 翻訳セッション用APIエンドポイント =====
    // クライアントがOpenAIと直接通信するための使い捨てトークン（エフェメラルキー）を発行する
    if (parsedUrl.pathname === '/api/translate-session' && req.method === 'POST') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OPENAI_API_KEYが設定されていません' }));
        return;
      }

      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const user = await authenticateSocket(req.headers.cookie);
          if (!user) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '認証が必要です' }));
            return;
          }

          const requestData = body ? JSON.parse(body) : {};
          const targetLanguage = typeof requestData.targetLanguage === 'string' ? requestData.targetLanguage : 'ja';
          const roomId = typeof requestData.roomId === 'string' ? requestData.roomId.trim() : '';

          if (!TRANSLATION_LANGUAGES.has(targetLanguage)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '対応していない翻訳先言語です' }));
            return;
          }

          if (!roomId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 'room-required', error: '通話ルームが確認できません' }));
            return;
          }

          const room = callRooms.get(roomId);
          if (!room) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 'call-not-ready', error: '相手が通話に参加してからAI翻訳を利用できます' }));
            return;
          }

          const activeUserIds = new Set<string>();
          for (const socketId of Array.from(room)) {
            const participantSocket = globalIo?.sockets.sockets.get(socketId);
            const participantUserId = participantSocket?.data.user?.id;
            const participantRoomId = participantSocket?.data.callRoomId;
            if (!participantSocket || !participantUserId || participantRoomId !== roomId) {
              room.delete(socketId);
              continue;
            }
            activeUserIds.add(participantUserId);
          }

          if (room.size === 0) callRooms.delete(roomId);

          if (!activeUserIds.has(user.id) || !Array.from(activeUserIds).some(userId => userId !== user.id)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 'call-not-ready', error: '相手が通話に参加してからAI翻訳を利用できます' }));
            return;
          }

          const requestBody = {
            session: {
              model: 'gpt-realtime-translate',
              audio: {
                output: {
                  language: targetLanguage,
                },
              },
            },
          };
          const response = await fetch(
            'https://api.openai.com/v1/realtime/translations/client_secrets',
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(requestBody),
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenAI トークン発行エラー:', response.status, errorText);
            res.writeHead(response.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'OpenAIトークンの発行に失敗しました', details: errorText }));
            return;
          }

          const data = await response.json();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...data, targetLanguage }));
        } catch (err) {
          console.error('翻訳セッションエラー:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '翻訳セッションの開始に失敗しました' }));
        }
      });
      return;
    }

    // ===== 授業記録の要約APIエンドポイント =====
    // 字幕ログをGPT-4o-miniで要約して返す
    if (parsedUrl.pathname === '/api/summarize' && req.method === 'POST') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OPENAI_API_KEYが設定されていません' }));
        return;
      }

      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', async () => {
        let placeholderMessageId: string | null = null;
        let summaryChannelId: string | null = null;
        let summaryRoomId: string | null = null;
        let summaryRoomName = "";
        let summaryOwnerId: string | null = null;
        let responseLanguage = 'ja';
        try {
          const user = await authenticateSocket(req.headers.cookie);
          if (!user) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '認証が必要です' }));
            return;
          }

          if (user.role !== "TEACHER") {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '先生アカウントのみ実行可能です' }));
            return;
          }
          summaryOwnerId = user.id;

          const { transcript, roomName, duration, language, channelId } = JSON.parse(body);
          summaryRoomName = typeof roomName === "string" ? roomName : "";
          responseLanguage = language === 'en' ? 'en' : 'ja';
          const transcriptText = typeof transcript === 'string' ? transcript.trim() : '';

          if (!channelId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '投稿先チャンネルが指定されていません' }));
            return;
          }

          const summaryChannel = await prisma.channel.findUnique({
            where: { id: channelId },
            include: {
              room: {
                select: { ownerId: true },
              },
            },
          });

          if (
            !summaryChannel ||
            summaryChannel.type !== "LESSON_RECORD" ||
            !summaryChannel.teacherOnly ||
            summaryChannel.room.ownerId !== user.id
          ) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'このチャンネルへ要約を投稿する権限がありません' }));
            return;
          }

          summaryChannelId = channelId;
          summaryRoomId = summaryChannel.roomId;

          if (transcriptText.length === 0) {
            const emptyContent = responseLanguage === 'en'
              ? '📝 **AI Lesson Summary**\n\nNo subtitle log was captured during this lesson, so an AI summary could not be created.'
              : '📝 **AI レッスン要約**\n\nこのレッスンでは字幕ログが記録されなかったため、AI要約を作成できませんでした。';
            const msg = await prisma.message.create({
              data: {
                content: emptyContent,
                authorId: user.id,
                channelId,
              },
              include: { author: { select: { id: true, name: true, role: true, avatarUrl: true } } }
            });

            if (globalIo) {
              globalIo.to(`channel:${channelId}`).emit("new_message", {
                id: msg.id,
                channelId: msg.channelId,
                content: msg.content,
                isSystem: msg.isSystem,
                isPinned: msg.isPinned,
                isEdited: false,
                createdAt: msg.createdAt.toISOString(),
                author: msg.author,
                files: [],
                replyTo: null,
              });
            }
            await sendAppNotification({
              userIds: summaryOwnerId ? [summaryOwnerId] : [],
              kind: "summary",
              title: {
                ja: "AIレッスン要約を確認してください",
                en: "Check the AI lesson summary",
              },
              body: {
                ja: "字幕ログがなかったため、要約は作成されませんでした。",
                en: "No subtitle log was captured, so a summary was not created.",
              },
              roomId: summaryRoomId || undefined,
              channelId,
              messageId: msg.id,
              url: buildNotificationUrl(channelId, msg.id),
              tag: `summary:${msg.id}`,
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ summary: emptyContent, skipped: true }));
            return;
          }
          
          const msg = await prisma.message.create({
            data: {
              content: responseLanguage === 'en' ? '⏳ AI is generating the lesson summary...\n(This may take 10-30 seconds)' : '⏳ AIがレッスン要約を作成中です...\n(数十秒かかります)',
              authorId: user.id,
              channelId,
            },
            include: { author: { select: { id: true, name: true, role: true, avatarUrl: true } } }
          });
          placeholderMessageId = msg.id;

          if (globalIo) {
            globalIo.to(`channel:${channelId}`).emit("new_message", {
              id: msg.id,
              channelId: msg.channelId,
              content: msg.content,
              isSystem: msg.isSystem,
              isPinned: msg.isPinned,
              isEdited: false,
              createdAt: msg.createdAt.toISOString(),
              author: msg.author,
              files: [],
              replyTo: null,
            });
          }

          const durationMin = duration ? Math.round(duration / 60) : '不明';
          const systemPrompt = responseLanguage === 'en'
            ? `You are an assistant who creates detailed memory notes for one-on-one guitar lessons.
Use the subtitle log to preserve concrete details that help the teacher continue the relationship naturally in the next lesson.

Output in English using this format:

## Lesson Overview
(2-4 lines with the main theme, progress, and mood of the lesson)

## Detailed Lesson Notes
- Practiced songs, sections, chords, phrases, rhythms, tempos, gear, or techniques.
- Specific mistakes, corrections, improvements, and moments where the student understood something.
- Keep concrete details instead of vague summaries.

## Teacher Advice
- Specific advice, demonstrations, practice methods, and warnings from the teacher.

## Student Notes & Casual Chat
- Student life updates, plans, hobbies, work/school, health, family, trips, movies, concerts, jokes, worries, or preferences.
- Preserve details that could be used as a warm follow-up next time.
- If no casual chat was mentioned, write "None in particular".

## Follow-up Prompts for Next Lesson
- Natural questions the teacher can ask next time, based only on facts in the transcript.
- Example style: "How was the movie you said you were going to see?"

## Homework / Next Steps
- Assigned practice, what to review, and what to prepare for next time.

## Unclear / Needs Confirmation
- Only include items that were ambiguous because of translation or missing context.

Rules:
- Do not invent facts. If the transcript does not mention something, say it was not mentioned.
- The subtitle log may contain translation errors, so infer cautiously from context.
- Keep names, song titles, chord names, numbers, dates, and personal details when they appear.
- Prefer useful detail over brevity.`
            : `あなたはマンツーマンのギターレッスンを、次回の会話や指導に使えるように詳しく記録するアシスタントです。
字幕ログから、先生が次のレッスンで自然に続きの話をできる具体的な情報を残してください。

以下の形式で日本語で出力してください:

## 授業概要
(今日のテーマ、進み具合、レッスン全体の雰囲気を2〜4行で)

## 詳細なレッスン内容
- 練習した曲、箇所、コード、フレーズ、リズム、テンポ、機材、テクニック。
- 生徒がつまずいた点、直した点、改善した点、理解できた瞬間。
- 「コードを練習した」だけで終わらせず、ログにある具体名や細部を残す。

## 先生からのアドバイス
- 先生が伝えた具体的な指摘、弾き方、練習方法、注意点。

## 生徒メモ・雑談
- 生徒の近況、予定、趣味、仕事や学校、体調、家族、旅行、映画、ライブ、冗談、悩み、好み。
- 次回「この前の映画どうだった？」のように声をかけられる情報を残す。
- 該当する雑談がなければ「特になし」と書く。

## 次回の声かけ候補
- 字幕ログにある事実だけをもとに、次回先生が自然に聞ける質問を書く。
- 例: 「このあと見に行くと言っていた映画はどうでしたか？」

## 宿題・次回までにやること
- 指定された練習、復習すること、次回準備するもの。

## あいまい・要確認
- 翻訳や文脈不足で確信できない内容だけを書く。

ルール:
- 事実を作らない。ログにないことは「記録なし」と判断する。
- 字幕は翻訳されている可能性があるため、文脈から慎重に推測する。
- 名前、曲名、コード名、数字、日付、個人的な予定や好みが出たらできるだけ残す。
- 短さよりも、次回の会話と指導に役立つ具体性を優先する。`;

          const userPrompt = responseLanguage === 'en'
            ? `Room: ${roomName || 'Unknown'}\nDuration: approx ${durationMin} min\n\n--- Subtitle Log ---\n${transcriptText}`
            : `部屋名: ${roomName || '不明'}\n授業時間: 約${durationMin}分\n\n--- 字幕ログ ---\n${transcriptText}`;

          console.log('📝 要約リクエスト: テキスト長', transcriptText.length, '文字');

          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              max_tokens: 2000,
              temperature: 0.3,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('要約APIエラー:', response.status, errorText);
            throw new Error(`要約APIエラー (${response.status}): ${errorText.substring(0, 500)}`);
          }

          const data = await response.json();
          const summary = data.choices?.[0]?.message?.content || '要約を生成できませんでした';
          console.log('✅ 要約完了:', summary.substring(0, 100));

          const summaryTitle = responseLanguage === 'en' ? '📝 **AI Lesson Summary**\n\n' : '📝 **AI レッスン要約**\n\n';
          const finalContent = `${summaryTitle}${summary}`;

          // プレースホルダーがあれば更新、なければ完了として返す
          if (placeholderMessageId && summaryChannelId) {
            await prisma.message.update({
              where: { id: placeholderMessageId },
              data: { content: finalContent },
            });
            if (globalIo) {
              globalIo.to(`channel:${summaryChannelId}`).emit("message_edited", {
                channelId: summaryChannelId,
                messageId: placeholderMessageId,
                content: finalContent,
              });
            }
            await sendAppNotification({
              userIds: summaryOwnerId ? [summaryOwnerId] : [],
              kind: "summary",
              title: {
                ja: "AIレッスン要約ができました",
                en: "AI lesson summary is ready",
              },
              body: {
                ja: `${summaryRoomName || "レッスン"}の要約をレッスン記録に投稿しました。`,
                en: `The summary for ${summaryRoomName || "the lesson"} was posted to lesson records.`,
              },
              roomId: summaryRoomId || undefined,
              channelId: summaryChannelId,
              messageId: placeholderMessageId,
              url: buildNotificationUrl(summaryChannelId, placeholderMessageId),
              tag: `summary:${placeholderMessageId}`,
            });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ summary: finalContent }));
        } catch (err) {
          console.error('要約エラー:', err);
          
          if (placeholderMessageId && summaryChannelId) {
            const errorContent = responseLanguage === 'en'
              ? '⚠️ Failed to create the AI lesson summary. Please try again later.'
              : '⚠️ AIレッスン要約の作成に失敗しました。時間をおいてもう一度お試しください。';
            await prisma.message.update({
              where: { id: placeholderMessageId },
              data: { content: errorContent },
            }).catch((updateError) => {
              console.error('要約エラー通知の更新に失敗:', updateError);
            });
            globalIo?.to(`channel:${summaryChannelId}`).emit("message_edited", {
              channelId: summaryChannelId,
              messageId: placeholderMessageId,
              content: errorContent,
            });
            await sendAppNotification({
              userIds: summaryOwnerId ? [summaryOwnerId] : [],
              kind: "summary",
              title: {
                ja: "AIレッスン要約に失敗しました",
                en: "AI lesson summary failed",
              },
              body: {
                ja: "レッスン記録チャンネルで内容を確認できます。",
                en: "Open the lesson record channel to check the status.",
              },
              roomId: summaryRoomId || undefined,
              channelId: summaryChannelId,
              messageId: placeholderMessageId,
              url: buildNotificationUrl(summaryChannelId, placeholderMessageId),
              tag: `summary:${placeholderMessageId}`,
            });
          }

          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '要約の処理に失敗しました' }));
        }
      });
      return;
    }

    // ===== チャットメッセージ翻訳APIエンドポイント =====
    // テキストメッセージを指定言語に翻訳して返す
    if (parsedUrl.pathname === '/api/translate-text' && req.method === 'POST') {
      console.log('✅ /api/translate-text にリクエストが到達しました');
      const apiKey = process.env.OPENAI_API_KEY;
      console.log('🔑 API Key の存在:', !!apiKey);

      if (!apiKey) {
        console.error('❌ OPENAI_API_KEYが設定されていません');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OPENAI_API_KEYが設定されていません' }));
        return;
      }

      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const user = await authenticateSocket(req.headers.cookie);
          if (!user) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '認証が必要です' }));
            return;
          }

          const { text, targetLanguage } = JSON.parse(body);

          if (!text || !text.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '翻訳するテキストがありません' }));
            return;
          }

          if (!targetLanguage) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '翻訳先言語が指定されていません' }));
            return;
          }

          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content: `You are a translator for a guitar lesson chat. Translate the following message into ${targetLanguage}. Rules:
- Output ONLY the translated text, nothing else.
- Keep the tone natural and conversational.
- Do NOT translate file names, URLs, music terminology that is commonly used in its original form (e.g., "C major", "Am7"), or emoji.
- If the message is already in the target language, return it as-is.`,
                },
                { role: 'user', content: text },
              ],
              max_tokens: 500,
              temperature: 0.3,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('翻訳APIエラー:', response.status, errorText);
            res.writeHead(response.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '翻訳に失敗しました', details: errorText }));
            return;
          }

          const data = await response.json();
          const translated = data.choices?.[0]?.message?.content?.trim() || text;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ translated }));
        } catch (err) {
          console.error('テキスト翻訳エラー:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'テキスト翻訳の処理に失敗しました' }));
        }
      });
      return;
    }

    handle(req, res, parsedUrl);
  });

  // Socket.IOサーバーを作成（CORSはsameSiteなので不要）
  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    // dev環境ではCORS許可
    cors: dev ? { origin: `http://${hostname}:${port}`, credentials: true } : undefined,
  });
  
  // ioをグローバルに保持
  globalIo = io;
  setRealtimeServer(io);
  startLessonReminderWorker();
  startAnnouncementDeliveryWorker();

  // ==============================================
  // Socket.IO 接続ハンドラー
  // ==============================================
  // 接続完了を通知する前に認証する。直後の参加イベントの取りこぼしを防ぐ。
  io.use(async (socket, next) => {
    const user = await authenticateSocket(socket.handshake.headers.cookie);
    if (!user) return next(new Error("認証が必要です"));
    socket.data.user = user;
    next();
  });
  io.on("connection", async (socket) => {
    // JWT認証（cookieから取得）
    const user = socket.data.user as Awaited<ReturnType<typeof authenticateSocket>>;

    if (!user) {
      console.log("[Socket.IO] 認証失敗 → 切断");
      socket.emit("auth_error", { message: "認証が必要です" });
      socket.disconnect(true);
      return;
    }

    console.log(`[Socket.IO] 接続: ${user.name} (${user.role})`);

    // ユーザー情報をsocketに保存（後のイベントで使用）
    socket.data.user = user;
    socket.join(`user:${user.id}`);

    const validateCallAccess = async (roomId: string): Promise<{ ok: boolean; message?: string; code?: string }> => {
      try {
        const roomInfo = await prisma.room.findUnique({
          where: { id: roomId },
          select: { ownerId: true, studentId: true }
        });

        if (!roomInfo) {
          return { ok: false, code: "room-not-found", message: "ルームが見つかりません" };
        }

        if (user.role === "STUDENT" && roomInfo.studentId !== user.id) {
          return { ok: false, code: "forbidden", message: "この通話への参加権限がありません" };
        }

        if (user.role === "TEACHER" && roomInfo.ownerId !== user.id) {
          return { ok: false, code: "forbidden", message: "この通話への参加権限がありません" };
        }

        return { ok: true };
      } catch (err) {
        console.error("[Socket.IO] 通話権限チェックエラー:", err);
        return { ok: false, code: "server-error", message: "エラーが発生しました" };
      }
    };

    const isCallRoomFullForUser = (roomId: string): boolean => {
      const room = callRooms.get(roomId);
      if (!room) return false;

      for (const socketId of Array.from(room)) {
        const participantSocket = io.sockets.sockets.get(socketId);
        if (!participantSocket) {
          room.delete(socketId);
        }
      }

      if (room.size === 0) {
        callRooms.delete(roomId);
        return false;
      }

      const sameUserAlreadyJoined = Array.from(room).some((socketId) => {
        const participantSocket = io.sockets.sockets.get(socketId);
        return participantSocket?.data.user?.id === user.id;
      });

      return room.size >= 2 && !sameUserAlreadyJoined;
    };

    // ------------------------------------------
    // チャンネルに参加する
    // ------------------------------------------
    socket.on("join_channel", async (channelId: string) => {
      // チャンネルの存在確認 + アクセス権限の確認
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        include: {
          room: {
            select: { ownerId: true, studentId: true },
          },
        },
      });

      if (!channel) {
        socket.emit("error", { message: "チャンネルが見つかりません" });
        return;
      }

      // 先生は自分が所有するルーム、生徒は自分のルームのチャンネルにのみアクセス可能
      if (user.role === "TEACHER" && channel.room.ownerId !== user.id) {
        socket.emit("error", { message: "このチャンネルへのアクセス権がありません" });
        return;
      }

      if (user.role === "STUDENT" && channel.room.studentId !== user.id) {
        socket.emit("error", { message: "このチャンネルへのアクセス権がありません" });
        return;
      }

      // 先生専用チャンネルへの生徒アクセスをブロック
      if (user.role === "STUDENT" && channel.teacherOnly) {
        socket.emit("error", { message: "このチャンネルは先生専用です" });
        return;
      }

      // 以前のチャンネルから退出
      const currentRooms = Array.from(socket.rooms);
      currentRooms.forEach((room) => {
        if (room.startsWith("channel:")) {
          socket.leave(room);
        }
      });

      // 新しいチャンネルに参加
      socket.join(`channel:${channelId}`);
      console.log(`[Socket.IO] ${user.name} がチャンネル ${channelId} に参加`);

      // メッセージ履歴を送信（最新50件 + 過去があるか確認用に1件余分に取得）
      const initialMessages = await prisma.message.findMany({
        where: { channelId },
        orderBy: { createdAt: "desc" },
        take: 51,
        include: {
          author: {
            select: { id: true, name: true, role: true, avatarUrl: true },
          },
          files: {
            select: { id: true, filename: true, mimeType: true, size: true },
          },
          replyTo: {
            select: {
              id: true,
              content: true,
              author: { select: { id: true, name: true } },
            },
          },
        },
      });
      const hasMore = initialMessages.length > 50;
      const messages = initialMessages.slice(0, 50).reverse();

      socket.emit("channel_messages", {
        channelId,
        messages: messages.map((m: typeof messages[number]) => ({
          id: m.id,
          channelId: m.channelId,
          content: m.content,
          isSystem: m.isSystem,
          isPinned: m.isPinned,
          isEdited: m.createdAt.getTime() !== m.updatedAt.getTime(),
          createdAt: m.createdAt.toISOString(),
          author: m.author,
          files: m.files.map((f: typeof m.files[number]) => ({
            id: f.id,
            filename: f.filename,
            mimeType: f.mimeType,
            size: f.size,
            url: `/api/files/${f.id}`,
          })),
          replyTo: m.replyTo ? {
            id: m.replyTo.id,
            content: m.replyTo.content.slice(0, 100),
            author: m.replyTo.author,
          } : null,
        })),
        hasMore,
      });
    });

    socket.on("load_older_messages", async (
      data: { channelId: string; beforeMessageId: string },
      ack?: (response: { ok: boolean; error?: string; messages?: unknown[]; hasMore?: boolean }) => void,
    ) => {
      const { channelId, beforeMessageId } = data;

      try {
        if (!socket.rooms.has(`channel:${channelId}`)) {
          ack?.({ ok: false, error: "このチャンネルへのアクセス権がありません" });
          return;
        }

        const channel = await prisma.channel.findUnique({
          where: { id: channelId },
          include: {
            room: {
              select: { ownerId: true, studentId: true },
            },
          },
        });

        if (!channel) {
          ack?.({ ok: false, error: "チャンネルが見つかりません" });
          return;
        }

        if (user.role === "TEACHER" && channel.room.ownerId !== user.id) {
          ack?.({ ok: false, error: "このチャンネルへのアクセス権がありません" });
          return;
        }

        if (user.role === "STUDENT" && (channel.room.studentId !== user.id || channel.teacherOnly)) {
          ack?.({ ok: false, error: "このチャンネルへのアクセス権がありません" });
          return;
        }

        const anchorMessage = await prisma.message.findUnique({
          where: { id: beforeMessageId },
          select: { channelId: true, createdAt: true },
        });

        if (!anchorMessage || anchorMessage.channelId !== channelId) {
          ack?.({ ok: false, error: "基準になるメッセージが見つかりません" });
          return;
        }

        const olderMessages = await prisma.message.findMany({
          where: {
            channelId,
            createdAt: { lt: anchorMessage.createdAt },
          },
          orderBy: { createdAt: "desc" },
          take: 51,
          include: {
            author: {
              select: { id: true, name: true, role: true, avatarUrl: true },
            },
            files: {
              select: { id: true, filename: true, mimeType: true, size: true },
            },
            replyTo: {
              select: {
                id: true,
                content: true,
                author: { select: { id: true, name: true } },
              },
            },
          },
        });

        const hasMore = olderMessages.length > 50;
        const messages = olderMessages.slice(0, 50).reverse();

        ack?.({
          ok: true,
          hasMore,
          messages: messages.map((m: typeof messages[number]) => ({
            id: m.id,
            channelId: m.channelId,
            content: m.content,
            isSystem: m.isSystem,
            isPinned: m.isPinned,
            isEdited: m.createdAt.getTime() !== m.updatedAt.getTime(),
            createdAt: m.createdAt.toISOString(),
            author: m.author,
            files: m.files.map((f: typeof m.files[number]) => ({
              id: f.id,
              filename: f.filename,
              mimeType: f.mimeType,
              size: f.size,
              url: `/api/files/${f.id}`,
            })),
            replyTo: m.replyTo ? {
              id: m.replyTo.id,
              content: m.replyTo.content.slice(0, 100),
              author: m.replyTo.author,
            } : null,
          })),
        });
      } catch (err) {
        console.error("[Socket.IO] 過去メッセージ読み込みエラー:", err);
        ack?.({ ok: false, error: "過去のメッセージ読み込みに失敗しました" });
      }
    });

    // ------------------------------------------
    // メッセージを送信する
    // ------------------------------------------
    socket.on("send_message", async (
      data: { channelId: string; content: string; fileIds?: string[]; replyToId?: string },
      ack?: (response: { ok: boolean; error?: string; message?: unknown }) => void,
    ) => {
      const { channelId, content, replyToId } = data;
      const uniqueFileIds = Array.from(new Set(data.fileIds || []));

      try {
        if ((!content || !content.trim()) && uniqueFileIds.length === 0) {
          ack?.({ ok: false, error: "送信する内容がありません" });
          return;
        }

        // join_channel 時に権限チェック済みのチャンネルだけ送信を許可する
        if (!socket.rooms.has(`channel:${channelId}`)) {
          const error = "このチャンネルへの送信権限がありません";
          socket.emit("error", { message: error });
          ack?.({ ok: false, error });
          return;
        }

        if (replyToId) {
          const replyTarget = await prisma.message.findUnique({
            where: { id: replyToId },
            select: { channelId: true },
          });
          if (!replyTarget || replyTarget.channelId !== channelId) {
            ack?.({ ok: false, error: "返信先のメッセージがこのチャンネルにありません" });
            return;
          }
        }

        let fileAttachments: Array<{ id: string; filename: string; mimeType: string; size: number; url: string }> = [];
        if (uniqueFileIds.length > 0) {
          const files = await prisma.file.findMany({
            where: {
              id: { in: uniqueFileIds },
              channelId,
              uploadedById: user.id,
              messageId: null,
            },
            select: { id: true, filename: true, mimeType: true, size: true },
          });

          if (files.length !== uniqueFileIds.length) {
            ack?.({ ok: false, error: "添付ファイルを確認できませんでした。もう一度選び直してください" });
            return;
          }

          fileAttachments = files.map(f => ({
            id: f.id,
            filename: f.filename,
            mimeType: f.mimeType,
            size: f.size,
            url: `/api/files/${f.id}`,
          }));
        }

        const message = await prisma.message.create({
          data: {
            content: content ? content.trim() : "",
            authorId: user.id,
            channelId,
            ...(replyToId ? { replyToId } : {}),
          },
          include: {
            author: {
              select: { id: true, name: true, role: true, avatarUrl: true },
            },
            channel: {
              select: {
                roomId: true,
                type: true,
                name: true,
                teacherOnly: true,
                room: { select: { ownerId: true, studentId: true } },
              },
            },
            replyTo: {
              select: {
                id: true,
                content: true,
                author: { select: { id: true, name: true } },
              },
            },
          },
        });

        if (uniqueFileIds.length > 0) {
          await prisma.file.updateMany({
            where: {
              id: { in: uniqueFileIds },
              channelId,
              uploadedById: user.id,
              messageId: null,
            },
            data: { messageId: message.id },
          });
        }

        if (!message.channel.teacherOnly) {
          const previewText = content?.trim()
            ? content.trim()
            : fileAttachments.length > 0
              ? `📎 ${fileAttachments[0].filename}`
              : "";
          if (previewText) {
            await prisma.room.update({
              where: { id: message.channel.roomId },
              data: {
                lastMessage: previewText,
                lastMessageAt: message.createdAt,
              },
            });
            io.to(`user:${message.channel.room.ownerId}`)
              .to(`user:${message.channel.room.studentId}`)
              .emit("rooms_updated", { roomId: message.channel.roomId, reason: "message" });
          }
        }

        const messagePayload = {
          id: message.id,
          channelId: message.channelId,
          content: message.content,
          isSystem: message.isSystem,
          isPinned: message.isPinned,
          isEdited: false,
          createdAt: message.createdAt.toISOString(),
          author: message.author,
          files: fileAttachments,
          replyTo: message.replyTo ? {
            id: message.replyTo.id,
            content: message.replyTo.content.slice(0, 100),
            author: message.replyTo.author,
          } : null,
        };

        io.to(`channel:${channelId}`).emit("new_message", messagePayload);
        if (content?.trim() || fileAttachments.length > 0) {
          const firstFileName = fileAttachments[0]?.filename;
          const bodyText = content?.trim() || firstFileName || "チャンネルを確認してください。";
          const isMaterialChannel = message.channel.type === "MATERIAL";
          const targetUserIds = message.channel.teacherOnly
            ? [message.channel.room.ownerId]
            : [message.channel.room.ownerId, message.channel.room.studentId];

          sendAppNotification({
            userIds: targetUserIds,
            excludeUserId: user.id,
            kind: "message",
            title: isMaterialChannel && fileAttachments.length > 0
              ? { ja: "教材が届きました", en: "New material shared" }
              : { ja: "新しいメッセージ", en: "New message" },
            body: {
              ja: `${user.name}: ${bodyText}`,
              en: `${user.name}: ${bodyText}`,
            },
            roomId: message.channel.roomId,
            channelId,
            messageId: message.id,
            url: buildNotificationUrl(channelId, message.id),
            tag: `message:${channelId}`,
          }).catch((error) => {
            console.error("[Notifications] メッセージ通知エラー:", error);
          });
        }
        ack?.({ ok: true, message: messagePayload });
        console.log(`[Socket.IO] メッセージ: ${user.name} → ${channelId}: ${content ? content.slice(0, 30) : '📎ファイル'}...`);
      } catch (err) {
        console.error("[Socket.IO] メッセージ送信エラー:", err);
        ack?.({ ok: false, error: "メッセージ送信に失敗しました" });
      }
    });

    // ------------------------------------------
    // メッセージを編集する
    // ------------------------------------------
    socket.on("edit_message", async (data: { messageId: string; content: string }) => {
      const { messageId, content } = data;
      if (!content || !content.trim()) return;

      try {
        const msg = await prisma.message.findUnique({
          where: { id: messageId },
          select: {
            authorId: true,
            channelId: true,
            channel: {
              select: {
                teacherOnly: true,
                room: { select: { ownerId: true, studentId: true } },
              },
            },
          },
        });
        if (!msg) return;

        if (
          (user.role === "TEACHER" && msg.channel.room.ownerId !== user.id) ||
          (user.role === "STUDENT" && (msg.channel.room.studentId !== user.id || msg.channel.teacherOnly))
        ) {
          socket.emit("error", { message: "このメッセージへの操作権限がありません" });
          return;
        }

        // 自分のメッセージのみ編集可能
        if (msg.authorId !== user.id) {
          socket.emit("error", { message: "自分のメッセージのみ編集できます" });
          return;
        }

        await prisma.message.update({
          where: { id: messageId },
          data: { content: content.trim() },
        });

        io.to(`channel:${msg.channelId}`).emit("message_edited", {
          channelId: msg.channelId,
          messageId,
          content: content.trim(),
        });
      } catch (err) {
        console.error("[Socket.IO] メッセージ編集エラー:", err);
      }
    });

    // ------------------------------------------
    // メッセージを削除する
    // ------------------------------------------
    socket.on("delete_message", async (data: { messageId: string }) => {
      const { messageId } = data;

      try {
        const msg = await prisma.message.findUnique({
          where: { id: messageId },
          select: {
            authorId: true,
            channelId: true,
            channel: {
              select: {
                teacherOnly: true,
                room: { select: { ownerId: true, studentId: true } },
              },
            },
          },
        });
        if (!msg) return;

        if (
          (user.role === "TEACHER" && msg.channel.room.ownerId !== user.id) ||
          (user.role === "STUDENT" && (msg.channel.room.studentId !== user.id || msg.channel.teacherOnly))
        ) {
          socket.emit("error", { message: "このメッセージへの操作権限がありません" });
          return;
        }

        // 自分のメッセージ or 先生なら削除可能
        if (msg.authorId !== user.id && user.role !== "TEACHER") {
          socket.emit("error", { message: "削除権限がありません" });
          return;
        }

        await prisma.message.delete({ where: { id: messageId } });

        io.to(`channel:${msg.channelId}`).emit("message_deleted", {
          channelId: msg.channelId,
          messageId,
        });
      } catch (err) {
        console.error("[Socket.IO] メッセージ削除エラー:", err);
      }
    });

    // ------------------------------------------
    // メッセージをピン留め/解除する
    // ------------------------------------------
    socket.on("pin_message", async (data: { messageId: string }) => {
      const { messageId } = data;

      try {
        const msg = await prisma.message.findUnique({
          where: { id: messageId },
          select: {
            isPinned: true,
            channelId: true,
            channel: {
              select: {
                room: { select: { ownerId: true } },
              },
            },
          },
        });
        if (!msg) return;

        // 先生のみピン留め可能
        if (user.role !== "TEACHER" || msg.channel.room.ownerId !== user.id) {
          socket.emit("error", { message: "ピン留めは先生のみ可能です" });
          return;
        }

        const newPinned = !msg.isPinned;
        await prisma.message.update({
          where: { id: messageId },
          data: { isPinned: newPinned },
        });

        io.to(`channel:${msg.channelId}`).emit("message_pinned", {
          channelId: msg.channelId,
          messageId,
          isPinned: newPinned,
        });
      } catch (err) {
        console.error("[Socket.IO] ピン留めエラー:", err);
      }
    });

    // ------------------------------------------
    // 教材キャンバスのリアルタイム描画同期
    // ------------------------------------------
    socket.on("draw_stroke", (data: { channelId: string; x0: number; y0: number; x1: number; y1: number; color: string; width: number }) => {
      // 送信元以外の同じチャンネルに参加している全員に送信
      socket.to(`channel:${data.channelId}`).emit("draw_stroke", data);
    });

    socket.on("clear_canvas", (data: { channelId: string }) => {
      socket.to(`channel:${data.channelId}`).emit("clear_canvas");
    });

    // ==============================================
    // 通話シグナリング（WebRTC接続の仲介）
    // ==============================================

    // カメラ・マイクを起動する前に、通話へ参加できるかだけ確認する
    socket.on("check-call-access", async (roomId: string, ack?: (response: { ok: boolean; message?: string; code?: string }) => void) => {
      const access = await validateCallAccess(roomId);
      if (!access.ok) {
        ack?.(access);
        return;
      }

      if (isCallRoomFullForUser(roomId)) {
        ack?.({ ok: false, code: "room-full", message: "通話ルームが満員です" });
        return;
      }

      ack?.({ ok: true });
    });

    // Push通知から開いたとき、招待元がまだ通話中かを認可付きで確認する
    socket.on("check-call-invite", async (
      roomId: string,
      ack?: (response: { ok: boolean; active: boolean; callerName?: string; callerRole?: "TEACHER" | "STUDENT"; message?: string }) => void
    ) => {
      const access = await validateCallAccess(roomId);
      if (!access.ok) {
        ack?.({ ok: false, active: false, message: access.message });
        return;
      }

      const participantIds = callRooms.get(roomId) || new Set<string>();
      const caller = Array.from(participantIds)
        .map((socketId) => io.sockets.sockets.get(socketId)?.data.user)
        .find((participant) => participant && participant.id !== user.id);

      if (!caller) {
        ack?.({ ok: true, active: false });
        return;
      }

      ack?.({
        ok: true,
        active: true,
        callerName: caller.name,
        callerRole: caller.role,
      });
    });

    // 通話ルームに参加する
    socket.on("join-call", async (roomId: string, ack?: (response: { ok: boolean; message?: string; code?: string }) => void) => {
      const access = await validateCallAccess(roomId);
      if (!access.ok) {
        socket.emit("error", { message: access.message || "この通話への参加権限がありません" });
        ack?.(access);
        return;
      }

      const room = callRooms.get(roomId) || new Set();
      const previousRoomId = socket.data.callRoomId as string | undefined;
      if (previousRoomId && previousRoomId !== roomId) {
        socket.leave(`call:${previousRoomId}`);
        const previousRoom = callRooms.get(previousRoomId);
        if (previousRoom) {
          previousRoom.delete(socket.id);
          if (previousRoom.size === 0) callRooms.delete(previousRoomId);
        }
        socket.to(`call:${previousRoomId}`).emit("peer-left");
        socket.data.callRoomId = null;
      }

      for (const socketId of Array.from(room)) {
        const participantSocket = io.sockets.sockets.get(socketId);
        if (!participantSocket) {
          room.delete(socketId);
          continue;
        }

        if (participantSocket.data.user?.id === user.id && participantSocket.id !== socket.id) {
          participantSocket.leave(`call:${roomId}`);
          participantSocket.data.callRoomId = null;
          participantSocket.emit("call-replaced", {
            message: "同じアカウントが別のタブで通話に参加したため、この通話を終了しました",
          });
          participantSocket.to(`call:${roomId}`).emit("peer-left");
          room.delete(socketId);
        }
      }

      // 通話ルームは最大2人（先生 + 生徒）
      if (room.size >= 2) {
        socket.emit("room-full");
        ack?.({ ok: false, code: "room-full", message: "通話ルームが満員です" });
        return;
      }

      // 通話ルームに参加
      socket.join(`call:${roomId}`);
      room.add(socket.id);
      callRooms.set(roomId, room);
      socket.data.callRoomId = roomId;

      console.log(`[Call] ${user.name} が通話ルーム ${roomId} に参加 (${room.size}人)`);
      ack?.({ ok: true });

      // 相手に通知
      socket.to(`call:${roomId}`).emit("peer-joined");
    });

    // 通話ルームから退出する
    socket.on("leave-call", () => {
      const roomId = socket.data.callRoomId;
      if (!roomId) return;

      socket.leave(`call:${roomId}`);
      const room = callRooms.get(roomId);
      if (room) {
        room.delete(socket.id);
        if (room.size === 0) callRooms.delete(roomId);
      }

      // 相手に退出を通知
      socket.to(`call:${roomId}`).emit("peer-left");
      socket.data.callRoomId = null;
      console.log(`[Call] ${user.name} が通話ルーム ${roomId} から退出`);
    });

    // WebRTCシグナリング: Offerを相手に転送
    socket.on("offer", (offer: RTCSessionDescriptionInit) => {
      const roomId = socket.data.callRoomId;
      if (roomId) socket.to(`call:${roomId}`).emit("offer", offer);
    });

    // WebRTCシグナリング: Answerを相手に転送
    socket.on("answer", (answer: RTCSessionDescriptionInit) => {
      const roomId = socket.data.callRoomId;
      if (roomId) socket.to(`call:${roomId}`).emit("answer", answer);
    });

    // WebRTCシグナリング: ICE候補を相手に転送
    socket.on("ice-candidate", (candidate: RTCIceCandidateInit) => {
      const roomId = socket.data.callRoomId;
      if (roomId) socket.to(`call:${roomId}`).emit("ice-candidate", candidate);
    });

    // 通話への招待を相手に送信
    socket.on("call-invite", async (data: { roomId: string }) => {
      const roomId = data.roomId;
      try {
        const room = await prisma.room.findUnique({
          where: { id: roomId },
          select: {
            ownerId: true,
            studentId: true,
            channels: {
              where: { type: "CHAT" },
              select: { id: true },
              take: 1,
            },
          },
        });
        if (!room) return;
        if (user.role === "TEACHER" && room.ownerId !== user.id) return;
        if (user.role === "STUDENT" && room.studentId !== user.id) return;

        const targetUserId = user.role === "TEACHER" ? room.studentId : room.ownerId;
        io.to(`user:${targetUserId}`).emit("call-invite", {
          roomId,
          callerName: user.name,
          callerRole: user.role,
        });
        const chatChannelId = room.channels[0]?.id;
        await sendAppNotification({
          userIds: [targetUserId],
          kind: "call_invite",
          title: {
            ja: "レッスン通話に招待されています",
            en: "Lesson call invitation",
          },
          body: {
            ja: `${user.name}さんが通話を開始しました。`,
            en: `${user.name} started the call.`,
          },
          roomId,
          channelId: chatChannelId,
          url: buildNotificationUrl(chatChannelId, undefined, { callInvite: roomId }),
          tag: `call-invite:${roomId}`,
        });
      } catch (err) {
        console.error("[Socket.IO] call-invite 権限チェックエラー:", err);
      }
    });

    // 通話招待への応答
    socket.on("call-invite-response", async (data: { roomId: string; accepted: boolean }) => {
      try {
        const room = await prisma.room.findUnique({
          where: { id: data.roomId },
          select: { ownerId: true, studentId: true },
        });
        if (!room) return;
        if (user.role === "TEACHER" && room.ownerId !== user.id) return;
        if (user.role === "STUDENT" && room.studentId !== user.id) return;

        const targetUserId = user.role === "TEACHER" ? room.studentId : room.ownerId;
        io.to(`user:${targetUserId}`).emit("call-invite-response", {
          accepted: data.accepted,
          responderName: user.name,
        });
      } catch (err) {
        console.error("[Socket.IO] call-invite-response 権限チェックエラー:", err);
      }
    });

    // リアルタイム翻訳字幕を相手に転送
    socket.on("translated-subtitle", (data: { text: string; final?: boolean }) => {
      const roomId = socket.data.callRoomId;
      if (roomId) socket.to(`call:${roomId}`).emit("translated-subtitle", data);
    });

    // 通話中の音声入力モードを相手に共有する
    socket.on("call-audio-mode", (data: { mode: "mic-only" | "dual" }) => {
      const roomId = socket.data.callRoomId;
      if (roomId) socket.to(`call:${roomId}`).emit("call-audio-mode", data);
    });

    // 翻訳先言語の設定を相手に転送
    socket.on("target-language", (data: { language: string; enabled?: boolean }) => {
      const roomId = socket.data.callRoomId;
      if (roomId) socket.to(`call:${roomId}`).emit("target-language", data);
    });

    // YouTube 同期視聴イベント
    socket.on("youtube-play", (data: { time: number }) => {
      const roomId = socket.data.callRoomId;
      if (roomId) socket.to(`call:${roomId}`).emit("youtube-play", data);
    });

    socket.on("youtube-pause", (data: { time: number }) => {
      const roomId = socket.data.callRoomId;
      if (roomId) socket.to(`call:${roomId}`).emit("youtube-pause", data);
    });

    socket.on("youtube-seek", (data: { time: number }) => {
      const roomId = socket.data.callRoomId;
      if (roomId) socket.to(`call:${roomId}`).emit("youtube-seek", data);
    });

    socket.on("youtube-load", (data: { videoId: string }) => {
      const roomId = socket.data.callRoomId;
      if (roomId) socket.to(`call:${roomId}`).emit("youtube-load", data);
    });

    // ------------------------------------------
    // 切断
    // ------------------------------------------
    socket.on("disconnect", () => {
      console.log(`[Socket.IO] 切断: ${user.name}`);

      // 通話ルームからも退出
      const callRoomId = socket.data.callRoomId;
      if (callRoomId) {
        socket.to(`call:${callRoomId}`).emit("peer-left");
        const room = callRooms.get(callRoomId);
        if (room) {
          room.delete(socket.id);
          if (room.size === 0) callRooms.delete(callRoomId);
        }
      }
    });
  });

  // HTTPサーバーを起動
  httpServer.listen(port, hostname, () => {
    console.log(`\n  🌎 Actlas Server`);
    console.log(`  ├─ URL:       http://${hostname}:${port}`);
    console.log(`  ├─ Socket.IO: 有効`);
    console.log(`  └─ Mode:      ${dev ? "開発" : "本番"}\n`);
  });
});
