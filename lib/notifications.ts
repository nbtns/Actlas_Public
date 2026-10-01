import webPush from "web-push";
import { prisma } from "@/lib/prisma";
import { getRealtimeServer } from "@/lib/realtime";

export type AppNotificationKind =
  | "call_invite"
  | "message"
  | "reservation"
  | "lesson_reminder"
  | "summary"
  | "announcement";

export type LocalizedText = {
  ja: string;
  en?: string;
};

export type AppNotificationPayload = {
  id: string;
  kind: AppNotificationKind;
  title: string;
  body: string;
  roomId?: string;
  channelId?: string;
  messageId?: string;
  announcementId?: string;
  url: string;
  tag?: string;
  createdAt: string;
};

type SendAppNotificationInput = {
  userIds: string[];
  excludeUserId?: string;
  kind: AppNotificationKind;
  title: LocalizedText;
  body: LocalizedText;
  roomId?: string;
  channelId?: string;
  messageId?: string;
  announcementId?: string;
  url?: string;
  tag?: string;
};

type PushSubscriptionRecord = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type PushDeliveryResult =
  | { status: "sent" }
  | { status: "gone" }
  | { status: "failed"; statusCode?: number };

type SendAppNotificationOptions = {
  failOnPushError?: boolean;
};

let configuredVapidKey = "";

export function getVapidPublicKey() {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
}

export function isWebPushConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
}

export function buildNotificationUrl(
  channelId?: string,
  messageId?: string,
  extraParams?: Record<string, string | undefined>
) {
  const params = new URLSearchParams();
  if (channelId) params.set("channel", channelId);
  if (messageId) params.set("msg", messageId);
  Object.entries(extraParams || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) return false;

  const cacheKey = `${subject}:${publicKey}:${privateKey}`;
  if (configuredVapidKey !== cacheKey) {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    configuredVapidKey = cacheKey;
  }

  return true;
}

function pickText(text: LocalizedText, language: string | null | undefined) {
  return language === "en" && text.en ? text.en : text.ja;
}

function createPayload(
  input: SendAppNotificationInput,
  language: string | null | undefined
): AppNotificationPayload {
  return {
    id: `${input.kind}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    kind: input.kind,
    title: pickText(input.title, language),
    body: pickText(input.body, language),
    roomId: input.roomId,
    channelId: input.channelId,
    messageId: input.messageId,
    announcementId: input.announcementId,
    url: input.url || buildNotificationUrl(input.channelId, input.messageId),
    tag: input.tag,
    createdAt: new Date().toISOString(),
  };
}

function isSubscriptionGone(error: unknown) {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

async function sendPush(
  subscription: PushSubscriptionRecord,
  payload: AppNotificationPayload
): Promise<PushDeliveryResult> {
  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 }
    );
    return { status: "sent" };
  } catch (error) {
    if (isSubscriptionGone(error)) {
      await prisma.pushSubscription.update({
        where: { id: subscription.id },
        data: { revokedAt: new Date() },
      }).catch(() => undefined);
      return { status: "gone" };
    }
    const statusCode = (error as { statusCode?: number } | null)?.statusCode;
    console.error("[Notifications] Web Push送信エラー:", statusCode || "unknown");
    return { status: "failed", statusCode };
  }
}

async function recordChannelNotification(userId: string, channelId: string) {
  await prisma.notificationChannelState.upsert({
    where: { userId_channelId: { userId, channelId } },
    create: { userId, channelId },
    update: { notifiedAt: new Date() },
  });
}

export async function sendAppNotification(
  input: SendAppNotificationInput,
  options: SendAppNotificationOptions = {}
) {
  const uniqueUserIds = Array.from(new Set(input.userIds))
    .filter(Boolean)
    .filter((userId) => userId !== input.excludeUserId);

  if (uniqueUserIds.length === 0) {
    return { pushSent: 0, pushFailed: 0, pushGone: 0 };
  }

  const users = await prisma.user.findMany({
    where: { id: { in: uniqueUserIds } },
    select: {
      id: true,
      language: true,
      notificationsEnabled: true,
      pushSubscriptions: {
        where: { revokedAt: null },
        select: {
          id: true,
          endpoint: true,
          p256dh: true,
          auth: true,
        },
      },
    },
  });

  const io = getRealtimeServer();
  const webPushReady = configureWebPush();

  const deliveryResults = await Promise.all(users.map(async (user) => {
    const payload = createPayload(input, user.language);

    if (input.channelId) {
      await recordChannelNotification(user.id, input.channelId);
    }

    // 画面内のオレンジ通知はPush設定に関係なく表示する。
    io?.to(`user:${user.id}`).emit("app_notification", payload);

    if (!webPushReady || !user.notificationsEnabled || user.pushSubscriptions.length === 0) {
      return [] as PushDeliveryResult[];
    }

    return Promise.all(user.pushSubscriptions.map((subscription) => sendPush(subscription, payload)));
  }));

  const flattenedResults = deliveryResults.flat();
  const pushFailed = flattenedResults.filter((result) => result.status === "failed").length;
  const summary = {
    pushSent: flattenedResults.filter((result) => result.status === "sent").length,
    pushFailed,
    pushGone: flattenedResults.filter((result) => result.status === "gone").length,
  };

  if (options.failOnPushError && pushFailed > 0) {
    throw new Error("PUSH_DELIVERY_FAILED");
  }

  return summary;
}

export async function savePushSubscription(input: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}) {
  return prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
    },
    update: {
      userId: input.userId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
      revokedAt: null,
      lastSeenAt: new Date(),
    },
  });
}

export async function revokePushSubscription(endpoint: string, userId: string) {
  return prisma.pushSubscription.updateMany({
    where: { endpoint, userId },
    data: { revokedAt: new Date() },
  });
}

export async function hasActivePushSubscription(endpoint: string, userId: string) {
  const count = await prisma.pushSubscription.count({
    where: { endpoint, userId, revokedAt: null },
  });
  return count > 0;
}

export async function sendDeviceTestNotification(userId: string, endpoint: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      language: true,
      notificationsEnabled: true,
      pushSubscriptions: {
        where: { endpoint, revokedAt: null },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
        take: 1,
      },
    },
  });

  if (!user || user.pushSubscriptions.length === 0) {
    return { status: "not_registered" as const };
  }
  if (!user.notificationsEnabled) {
    return { status: "disabled" as const };
  }
  if (!configureWebPush()) {
    return { status: "not_configured" as const };
  }

  const payload = createPayload({
    userIds: [userId],
    kind: "message",
    title: { ja: "Actlasの通知テスト", en: "Actlas notification test" },
    body: {
      ja: "この端末で通知を受け取れることを確認できました。",
      en: "This device can receive notifications.",
    },
    url: "/",
    tag: "push-test",
  }, user.language);
  const result = await sendPush(user.pushSubscriptions[0], payload);

  if (result.status === "sent") return { status: "sent" as const };
  if (result.status === "gone") return { status: "not_registered" as const };
  return { status: "failed" as const };
}
