import test from "node:test";
import assert from "node:assert/strict";
import { assertDemoDatabaseUrl } from "../scripts/demo-environment.mjs";

test("local demo database is accepted", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const url = assertDemoDatabaseUrl(`postgresql://actlas_demo@${host}:55432/actlas_demo?schema=public`);
    assert.equal(url.pathname, "/actlas_demo");
  }
});
test("remote databases, other users and non-demo databases are refused", () => {
  for (const value of [
    "postgresql://actlas_demo@db.example.com/actlas_demo",
    "postgresql://actlas_demo@localhost/actlas",
    "postgresql://postgres@localhost/actlas_demo",
    "https://actlas_demo@localhost/actlas_demo",
    "",
  ]) {
    assert.throws(() => assertDemoDatabaseUrl(value));
  }
});
