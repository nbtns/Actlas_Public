import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(".env");
if (existsSync(envPath)) {
  console.log(".env は既にあります。既存の設定を上書きしません。");
  process.exit(0);
}
const databasePassword = randomBytes(24).toString("hex");
const accountPassword = randomBytes(16).toString("hex");
const lines = [
  "# ローカル評価専用。このファイルはGitに登録しない。",
  `DATABASE_URL=postgresql://actlas_demo:${databasePassword}@localhost:55432/actlas_demo?schema=public`,
  `JWT_SECRET=${randomBytes(32).toString("hex")}`,
  `DEMO_DB_PASSWORD=${databasePassword}`,
  `DEMO_ACCOUNT_PASSWORD=${accountPassword}`,
  "PORT=3100",
  "APP_URL=http://localhost:3100",
  "NEXT_PUBLIC_APP_MODE=standard",
  "",
];
writeFileSync(envPath, lines.join("\n"), { encoding: "utf8", mode: 0o600, flag: "wx" });
console.log(".env を作成しました。パスワードは .env の DEMO_ACCOUNT_PASSWORD で確認できます。");
console.log("先生: teacher@example.com / 生徒: student1@example.com、student2@example.com");
