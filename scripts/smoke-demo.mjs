import "dotenv/config";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import { SignJWT } from "jose";

const base = `http://localhost:${process.env.PORT || 3100}`;
const password = process.env.DEMO_ACCOUNT_PASSWORD;
assert.ok(password, "DEMO_ACCOUNT_PASSWORD is required");
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    const ready = await fetch(`${base}/login`, { signal: AbortSignal.timeout(3000) });
    if (ready.ok) break;
  } catch { /* Wait for local startup. */ }
  if (attempt === 119) throw new Error("Local server did not become ready");
  await new Promise((resolve) => setTimeout(resolve, 500));
}
async function json(path, cookie, method = "GET", body) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  return { res, data };
}
async function login(email) {
  const { res, data } = await json("/api/auth/login", undefined, "POST", { email, password });
  assert.equal(res.status, 200);
  assert.equal(data.requires2FA, undefined, "Public teacher login must not send email");
  const cookie = res.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ");
  assert.match(cookie, /token=/);
  return cookie;
}
async function demoLogin(demoRole, extra = {}) {
  const { res, data } = await json("/api/auth/login", undefined, "POST", { ...extra, demoRole });
  assert.equal(res.status, 200);
  assert.equal(data.requires2FA, undefined);
  assert.equal(data.user.role, demoRole);
  assert.equal(data.user.id, demoRole === "TEACHER" ? "demo-teacher" : "demo-student-1");
  assert.equal(data.password, undefined);
  assert.equal(data.user.password, undefined);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((part) => part.startsWith("token=") && /HttpOnly/i.test(part)));
  return cookies.map((part) => part.split(";")[0]).join("; ");
}
assert.equal((await json("/api/rooms")).res.status, 401);
for (const demoRole of ["ADMIN", "teacher", "demo-student-2", "", null, {}, []]) {
  assert.equal((await json("/api/auth/login", undefined, "POST", { demoRole })).res.status, 400);
}
// 入力に別アカウントを混ぜても、ボタンで選べる固定の先生・生徒だけに入る。
const teacher = await demoLogin("TEACHER", { email: "student2@example.com", password: "ignored" });
const student = await demoLogin("STUDENT", { email: "teacher@example.com", userId: "demo-teacher", role: "TEACHER" });
assert.equal((await json("/api/auth/me", teacher)).data.user.id, "demo-teacher");
assert.equal((await json("/api/auth/me", student)).data.user.id, "demo-student-1");
await login("teacher@example.com");
const otherStudent = await login("student2@example.com");
const teacherRooms = (await json("/api/rooms", teacher)).data.rooms;
const studentRooms = (await json("/api/rooms", student)).data.rooms;
assert.equal(teacherRooms.length, 2);
assert.equal(studentRooms.length, 1);
assert.equal(studentRooms[0].id, "demo-room-1");
assert.ok(studentRooms[0].channels.every((channel) => !channel.teacherOnly));
assert.ok(teacherRooms.some((room) => room.channels.some((channel) => channel.teacherOnly)));
const me = await json("/api/auth/me", student);
assert.equal(me.res.status, 200);
assert.equal(me.data.isFirstLogin ?? me.data.user?.isFirstLogin, false);
for (const path of ["/api/translate-session", "/api/translate-text", "/api/summarize", "/api/stripe/oauth/start"]) {
  const { res, data } = await json(path, teacher, "POST", {});
  assert.equal(res.status, 501);
  assert.equal(data.code, "PUBLIC_DEMO_FEATURE_DISABLED");
}
const profile = await json("/api/teacher-profile/public");
assert.equal(profile.res.status, 200);
assert.equal(profile.data.profile.user.name, "デモ先生");
assert.equal(profile.data.profile.menus[0].price, 0);

function socket(cookie) {
  return io(base, { extraHeaders: { Cookie: cookie }, transports: ["websocket"], reconnection: false, autoConnect: false });
}
async function eventWithTimeout(client, name, action) {
  const promise = Promise.race([
    once(client, name).then(([value]) => value),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Socket timeout: ${name}`)), 5000).unref()),
  ]);
  action();
  return promise;
}
const staleToken = await new SignJWT({ userId: "demo-student-1", role: "STUDENT", sessionVersion: -1 })
  .setProtectedHeader({ alg: "HS256" }).setExpirationTime("1m")
  .sign(new TextEncoder().encode(process.env.JWT_SECRET));
assert.equal((await json("/api/rooms", `token=${staleToken}`)).res.status, 401);
assert.equal((await json("/api/menus?roomId=demo-room-2", student)).res.status, 403);
for (const cookie of ["", `token=${staleToken}`]) {
  const invalid = socket(cookie);
  try {
    const denied = await eventWithTimeout(invalid, "connect_error", () => invalid.connect());
    assert.ok(denied.message);
  } finally { invalid.disconnect(); }
}
const teacherSocket = socket(teacher);
const studentSocket = socket(student);
const strangerSocket = socket(otherStudent);
try {
  await Promise.all([teacherSocket, studentSocket, strangerSocket].map((client) =>
    eventWithTimeout(client, "connect", () => client.connect())));
  const channel = "demo-channel-1-chat";
  await eventWithTimeout(teacherSocket, "channel_messages", () => teacherSocket.emit("join_channel", channel));
  await eventWithTimeout(studentSocket, "channel_messages", () => studentSocket.emit("join_channel", channel));
  const denied = await eventWithTimeout(strangerSocket, "error", () => strangerSocket.emit("join_channel", channel));
  assert.ok(denied.message);
  const teacherOnlyDenied = await eventWithTimeout(studentSocket, "error", () =>
    studentSocket.emit("join_channel", "demo-channel-1-lesson_record"));
  assert.ok(teacherOnlyDenied.message);
  const content = `公開版の通信確認 ${randomUUID()}`;
  const received = await eventWithTimeout(teacherSocket, "new_message", () =>
    studentSocket.emit("send_message", { channelId: channel, content }));
  assert.equal(received.content, content);
  assert.equal(received.author.id, "demo-student-1");
} finally {
  teacherSocket.disconnect();
  studentSocket.disconnect();
  strangerSocket.disconnect();
}
console.log("PASS: 先生・生徒のデモログイン、不正な役割の拒否、固定アカウント制限、パスワード非公開、JWT・ロール別ルーム、先生専用制御、リアルタイム投稿、他生徒の拒否、AI/決済停止。");
