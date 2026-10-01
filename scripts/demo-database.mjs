import "dotenv/config";
import { spawnSync } from "node:child_process";
import { assertDemoDatabaseUrl } from "./demo-environment.mjs";

assertDemoDatabaseUrl();
for (const args of [
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  ["--import", "tsx", "prisma/seed.ts"],
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
