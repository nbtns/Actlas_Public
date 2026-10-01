// ==============================================
// Prisma クライアント シングルトン
// 開発時のホットリロードでDB接続が増え続けるのを防ぐ
import { PrismaClient } from "@prisma/client";

// グローバル変数にPrismaクライアントを保持（開発時のみ）
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// 既存のインスタンスがあればそれを使い、なければ新しく作る
export const prisma = globalForPrisma.prisma ?? new PrismaClient({});

// 本番環境以外（開発時）はグローバルにキャッシュ
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
