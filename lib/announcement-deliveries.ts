import { prisma } from "@/lib/prisma";
import { isWebPushConfigured, sendAppNotification } from "@/lib/notifications";

const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_CLAIM_TIMEOUT_MS = 45 * 1000;
const DELIVERY_BATCH_SIZE = 100;
const DELIVERY_CONCURRENCY = 10;

let deliveryRunInProgress = false;

function deliveryErrorCode(error: unknown) {
  if (!(error instanceof Error)) return "ANNOUNCEMENT_NOTIFICATION_FAILED";
  if (error.message === "PUSH_DELIVERY_FAILED" || error.message === "PUSH_NOT_CONFIGURED") {
    return error.message;
  }
  return "ANNOUNCEMENT_NOTIFICATION_FAILED";
}

async function claimDelivery(id: string, now: Date) {
  const staleBefore = new Date(now.getTime() - DELIVERY_CLAIM_TIMEOUT_MS);
  const claimed = await prisma.announcementDelivery.updateMany({
    where: {
      id,
      deliveredAt: null,
      attempts: { lt: MAX_DELIVERY_ATTEMPTS },
      OR: [
        { lastAttemptAt: null },
        { lastAttemptAt: { lt: staleBefore } },
      ],
    },
    data: {
      attempts: { increment: 1 },
      lastAttemptAt: now,
      lastError: null,
    },
  });
  if (claimed.count === 0) return null;

  return prisma.announcementDelivery.findUnique({ where: { id } });
}

async function deliverOne(id: string) {
  const delivery = await claimDelivery(id, new Date());
  if (!delivery) return;

  try {
    const recipient = await prisma.user.findUnique({
      where: { id: delivery.recipientId },
      select: {
        notificationsEnabled: true,
        pushSubscriptions: {
          where: { revokedAt: null },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (
      recipient?.notificationsEnabled &&
      recipient.pushSubscriptions.length > 0 &&
      !isWebPushConfigured()
    ) {
      throw new Error("PUSH_NOT_CONFIGURED");
    }

    await sendAppNotification({
      userIds: [delivery.recipientId],
      kind: "announcement",
      title: { ja: delivery.titleJa, en: delivery.titleEn },
      body: { ja: delivery.bodyJa, en: delivery.bodyEn },
      announcementId: delivery.announcementId,
      url: delivery.url,
      tag: delivery.tag,
    }, { failOnPushError: true });

    await prisma.announcementDelivery.update({
      where: { id: delivery.id },
      data: { deliveredAt: new Date(), lastError: null },
    });
  } catch (error) {
    const lastError = deliveryErrorCode(error);
    await prisma.announcementDelivery.update({
      where: { id: delivery.id },
      data: { lastError },
    }).catch(() => undefined);
    console.error("[Announcements] 通知送信失敗:", delivery.id, lastError);
  }
}

export async function processPendingAnnouncementDeliveries(now = new Date()) {
  if (deliveryRunInProgress) return;
  deliveryRunInProgress = true;

  try {
    const staleBefore = new Date(now.getTime() - DELIVERY_CLAIM_TIMEOUT_MS);
    const pending = await prisma.announcementDelivery.findMany({
      where: {
        deliveredAt: null,
        attempts: { lt: MAX_DELIVERY_ATTEMPTS },
        OR: [
          { lastAttemptAt: null },
          { lastAttemptAt: { lt: staleBefore } },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: DELIVERY_BATCH_SIZE,
    });

    for (let index = 0; index < pending.length; index += DELIVERY_CONCURRENCY) {
      await Promise.all(pending.slice(index, index + DELIVERY_CONCURRENCY).map((item) => deliverOne(item.id)));
    }
  } finally {
    deliveryRunInProgress = false;
  }
}

export function wakeAnnouncementDeliveryWorker() {
  void processPendingAnnouncementDeliveries().catch((error) => {
    console.error("[Announcements] 通知再試行ワーカーエラー:", error);
  });
}
