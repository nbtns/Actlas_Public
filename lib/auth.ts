import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// 環境変数からシークレットキーを取得（文字列表現をUint8Arrayに変換）
const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error("JWT_SECRET environment variable is not set.");
  }
  return new TextEncoder().encode(secret);
};

// ==============================================
// パスワード関連
// ==============================================

/**
 * パスワードをハッシュ化する（DB保存用）
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/**
 * パスワードが正しいか検証する（ログイン用）
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ==============================================
// JWT関連
// ==============================================

export const AUTH_COOKIE = "token";
export const TWO_FACTOR_COOKIE = "two_factor_pending";
export const EMAIL_CHANGE_COOKIE = "email_change_pending";

export interface JwtPayload {
  userId: string;
  role: "TEACHER" | "STUDENT";
  sessionVersion: number;
}

interface TwoFactorPendingPayload {
  purpose: "2fa";
  userId: string;
  sessionVersion: number;
}

interface EmailChangePendingPayload {
  purpose: "email-change";
  userId: string;
  newEmail: string;
  code: string;
  sessionVersion: number;
}

export type ScopedTokenPayload = TwoFactorPendingPayload | EmailChangePendingPayload;

export function validatePasswordStrength(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 8) {
    return "パスワードは8文字以上にしてください";
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "パスワードには英字と数字を両方含めてください";
  }
  return null;
}

/**
 * JWTトークンを生成する（ログイン成功時に使用）
 */
export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d") // 30日間有効
    .sign(getJwtSecretKey());
}

export async function signScopedToken(
  payload: ScopedTokenPayload,
  expiresIn: string
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getJwtSecretKey());
}

export async function verifyScopedToken<T extends ScopedTokenPayload["purpose"]>(
  token: string,
  purpose: T
): Promise<Extract<ScopedTokenPayload, { purpose: T }> | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecretKey());
    if (payload.purpose !== purpose) return null;
    return payload as unknown as Extract<ScopedTokenPayload, { purpose: T }>;
  } catch {
    return null;
  }
}

/**
 * JWTトークンを検証・復号する（APIアクセス時の権限確認などに使用）
 */
export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecretKey());
    const decoded = payload as unknown as JwtPayload;
    if (
      !decoded.userId ||
      (decoded.role !== "TEACHER" && decoded.role !== "STUDENT") ||
      typeof decoded.sessionVersion !== "number"
    ) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true, sessionVersion: true },
    });

    if (!user || user.role !== decoded.role || user.sessionVersion !== decoded.sessionVersion) {
      return null;
    }

    return decoded;
  } catch {
    // トークンが不正、または期限切れ
    return null;
  }
}
