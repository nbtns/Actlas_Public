export const ANNOUNCEMENT_REACTIONS = ["👍", "❤️", "🎉", "👏", "👀"] as const;

export type AnnouncementReactionEmoji = (typeof ANNOUNCEMENT_REACTIONS)[number];

export type AnnouncementUpdatedPayload = {
  announcementId: string;
  reason: "created" | "updated" | "deleted" | "reaction";
};

export function isAnnouncementReactionEmoji(value: unknown): value is AnnouncementReactionEmoji {
  return typeof value === "string" && ANNOUNCEMENT_REACTIONS.includes(value as AnnouncementReactionEmoji);
}
