import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
}).split("\0").filter(Boolean);
const issues = [];
const forbidden = /(^|\/)(backups|uploads|\.review|node_modules|\.next)(\/|$)|(^|\/)\.env(?!\.example$)|\.(pem|key|p12|pfx|sqlite3?|db|dump|zip|log)$/i;
const secretPatterns = [
  /sk-(?:proj-)?[A-Za-z0-9_-]{30,}/,
  /sk_live_[A-Za-z0-9]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
for (const file of files) {
  if (forbidden.test(file)) { issues.push(`禁止ファイル: ${file}`); continue; }
  if (/\.(png|jpg|webp|ico)$/i.test(file)) continue;
  const content = readFileSync(file, "utf8");
  if (secretPatterns.some((pattern) => pattern.test(content))) issues.push(`秘密情報の疑い: ${file}`);
}
if (issues.length) {
  console.error(issues.join("\n"));
  process.exit(1);
}
console.log(`公開候補 ${files.length} ファイル: 禁止ファイル・既知の秘密キー形式の検出なし。`);
console.log("これは補助チェックです。Gitleaksや個人情報の目視確認の代わりにはなりません。");
