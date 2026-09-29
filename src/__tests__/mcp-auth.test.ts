import { describe, test } from "node:test";
import assert from "node:assert";
import express from "express";
import request from "supertest";
import { createMcpAuth, isLoopbackHost, resolveMcpToken } from "../mcp/auth";

const TOKEN = "s3cret-token-value";

function makeApp(token: string | undefined) {
  const app = express();
  app.use(createMcpAuth(token));
  app.post("/mcp/species", (_req, res) => res.status(200).send("ok"));
  return app;
}

void describe("isLoopbackHost", () => {
  void test("recognises loopback addresses", () => {
    for (const host of ["127.0.0.1", "localhost", "::1", "127.0.0.53"]) {
      assert.strictEqual(isLoopbackHost(host), true, host);
    }
  });

  void test("treats wildcard and private addresses as reachable", () => {
    for (const host of ["0.0.0.0", "::", "fly-local-6pn", "10.0.0.5", "fdaa::1"]) {
      assert.strictEqual(isLoopbackHost(host), false, host);
    }
  });
});

void describe("resolveMcpToken", () => {
  void test("loopback without a token is allowed", () => {
    assert.strictEqual(resolveMcpToken("127.0.0.1", undefined), undefined);
  });

  void test("non-loopback without a token refuses to start", () => {
    assert.throws(() => resolveMcpToken("0.0.0.0", undefined), /mcp\.token/);
    assert.throws(() => resolveMcpToken("0.0.0.0", ""), /mcp\.token/);
  });

  void test("short tokens are rejected", () => {
    assert.throws(() => resolveMcpToken("0.0.0.0", "short"), /at least/);
  });

  void test("a token set on loopback is still enforced", () => {
    assert.strictEqual(resolveMcpToken("127.0.0.1", TOKEN), TOKEN);
  });
});

void describe("createMcpAuth", () => {
  void test("no token configured lets requests through", async () => {
    await request(makeApp(undefined)).post("/mcp/species").expect(200);
  });

  void test("missing Authorization header is 401", async () => {
    await request(makeApp(TOKEN)).post("/mcp/species").expect(401);
  });

  void test("wrong token is 401", async () => {
    await request(makeApp(TOKEN))
      .post("/mcp/species")
      .set("Authorization", "Bearer wrong-token-value!")
      .expect(401);
  });

  void test("wrong scheme is 401", async () => {
    await request(makeApp(TOKEN))
      .post("/mcp/species")
      .set("Authorization", `Basic ${TOKEN}`)
      .expect(401);
  });

  void test("correct bearer token passes", async () => {
    await request(makeApp(TOKEN))
      .post("/mcp/species")
      .set("Authorization", `Bearer ${TOKEN}`)
      .expect(200);
  });
});
