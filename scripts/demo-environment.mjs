export function assertDemoDatabaseUrl(value = process.env.DATABASE_URL) {
  if (!value) throw new Error("先に npm run demo:setup を実行してください。");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/actlas_demo" ||
    url.username !== "actlas_demo"
  ) {
    throw new Error("ローカルの actlas_demo 専用DBだけを使用できます。本番DBは指定できません。");
  }
  return url;
}
