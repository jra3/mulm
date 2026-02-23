import { describe, test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import type { Response } from "express";
import { overrideConnection } from "../db/conn";

// sessions.ts
import {
  generateSessionCookie,
  sessionMiddleware,
  regenerateSession,
  destroyUserSession,
  type MulmRequest,
} from "../sessions";

// oauth.ts
import {
  isGoogleOAuthEnabled,
  isFacebookOAuthEnabled,
  setOAuthStateCookie,
  getGoogleOAuthURL,
  getFacebookOAuthURL,
  getGoogleUser,
  getFacebookUser,
} from "../oauth";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockReq(cookies: Record<string, string> = {}): MulmRequest {
  return { cookies } as unknown as MulmRequest;
}

type MockRes = Response & { _cookies: Record<string, { value: unknown; opts: unknown }> };

function mockRes(): MockRes {
  const _cookies: Record<string, { value: unknown; opts: unknown }> = {};
  return {
    cookie: (name: string, value: unknown, opts?: unknown) => {
      _cookies[name] = { value, opts };
    },
    _cookies,
  } as unknown as MockRes;
}

async function setupDb(): Promise<Database> {
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.migrate({ migrationsPath: "./db/migrations" });
  overrideConnection(db);
  return db;
}

async function createMember(db: Database): Promise<number> {
  const result = await db.run(
    "INSERT INTO members (display_name, contact_email) VALUES (?, ?)",
    ["Test User", "test@test.com"]
  );
  return result.lastID as number;
}

async function insertSession(
  db: Database,
  sessionId: string,
  memberId: number,
  expiresOn: string
): Promise<void> {
  await db.run("INSERT INTO sessions (session_id, member_id, expires_on) VALUES (?, ?, ?)", [
    sessionId,
    memberId,
    expiresOn,
  ]);
}

// ─── sessions.ts ─────────────────────────────────────────────────────────────

void describe("sessions.ts", () => {
  let db: Database;

  beforeEach(async () => {
    db = await setupDb();
  });

  afterEach(async () => {
    try {
      await db.close();
    } catch {
      // ignore
    }
  });

  void describe("generateSessionCookie", () => {
    void test("returns a non-empty string", () => {
      const cookie = generateSessionCookie();
      assert.ok(typeof cookie === "string" && cookie.length > 0);
    });

    void test("returns different values on successive calls", () => {
      const a = generateSessionCookie();
      const b = generateSessionCookie();
      assert.notStrictEqual(a, b);
    });
  });

  void describe("sessionMiddleware", () => {
    void test("sets req.viewer for a valid, non-expired session", async () => {
      const memberId = await createMember(db);
      const future = new Date(Date.now() + 86400 * 1000).toISOString();
      await insertSession(db, "valid-token", memberId, future);

      const req = mockReq({ session_id: "valid-token" });
      const res = mockRes();
      let nextCalled = false;

      await sessionMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.ok(nextCalled, "next() should be called");
      assert.ok(req.viewer, "viewer should be set");
      assert.strictEqual(req.viewer?.contact_email, "test@test.com");
    });

    void test("does not set req.viewer for an expired session", async () => {
      const memberId = await createMember(db);
      const past = new Date(Date.now() - 86400 * 1000).toISOString();
      await insertSession(db, "expired-token", memberId, past);

      const req = mockReq({ session_id: "expired-token" });
      const res = mockRes();

      await sessionMiddleware(req, res, () => {});

      assert.strictEqual(req.viewer, undefined);
    });

    void test("does not set req.viewer when token is not in DB", async () => {
      const req = mockReq({ session_id: "nonexistent-token" });
      const res = mockRes();

      await sessionMiddleware(req, res, () => {});

      assert.strictEqual(req.viewer, undefined);
    });

    void test("always calls next()", async () => {
      const req = mockReq({});
      const res = mockRes();
      let nextCalled = false;

      await sessionMiddleware(req, res, () => {
        nextCalled = true;
      });

      assert.ok(nextCalled);
    });
  });

  void describe("regenerateSession", () => {
    void test("creates a new session in the DB", async () => {
      const memberId = await createMember(db);
      const req = mockReq({ session_id: "undefined" }); // no prior session
      const res = mockRes();

      await regenerateSession(req, res, memberId);

      // A new session cookie should have been set
      const cookieEntry = res._cookies["session_id"];
      assert.ok(cookieEntry, "session_id cookie should be set");
      const newSessionId = cookieEntry.value as string;
      assert.ok(newSessionId && newSessionId.length > 0);

      // The new session should exist in the DB
      const row = await db.get<{ session_id: string }>(
        "SELECT session_id FROM sessions WHERE session_id = ?",
        [newSessionId]
      );
      assert.ok(row, "new session should exist in DB");
    });

    void test("deletes the old session when regenerating", async () => {
      const memberId = await createMember(db);
      const future = new Date(Date.now() + 86400 * 1000).toISOString();
      await insertSession(db, "old-session", memberId, future);

      const req = mockReq({ session_id: "old-session" });
      const res = mockRes();

      await regenerateSession(req, res, memberId);

      // Old session should be gone
      const old = await db.get("SELECT session_id FROM sessions WHERE session_id = ?", [
        "old-session",
      ]);
      assert.strictEqual(old, undefined, "old session should be deleted");
    });

    void test("cookie is set httpOnly and with correct maxAge", async () => {
      const memberId = await createMember(db);
      const req = mockReq({ session_id: "undefined" });
      const res = mockRes();

      await regenerateSession(req, res, memberId);

      const opts = res._cookies["session_id"]?.opts as Record<string, unknown>;
      assert.strictEqual(opts?.httpOnly, true);
      assert.strictEqual(opts?.sameSite, "lax");
      assert.ok(typeof opts?.maxAge === "number" && (opts.maxAge) > 0);
    });
  });

  void describe("destroyUserSession", () => {
    void test("deletes the session from the DB", async () => {
      const memberId = await createMember(db);
      const future = new Date(Date.now() + 86400 * 1000).toISOString();
      await insertSession(db, "session-to-delete", memberId, future);

      const req = mockReq({ session_id: "session-to-delete" });
      const res = mockRes();

      await destroyUserSession(req, res);

      const row = await db.get("SELECT session_id FROM sessions WHERE session_id = ?", [
        "session-to-delete",
      ]);
      assert.strictEqual(row, undefined, "session should be deleted from DB");
    });

    void test("sets session_id cookie to null", async () => {
      const memberId = await createMember(db);
      const future = new Date(Date.now() + 86400 * 1000).toISOString();
      await insertSession(db, "some-session", memberId, future);

      const req = mockReq({ session_id: "some-session" });
      const res = mockRes();

      await destroyUserSession(req, res);

      const cookieEntry = res._cookies["session_id"];
      assert.ok(cookieEntry, "session_id cookie should be set");
      assert.strictEqual(cookieEntry.value, null);
    });
  });
});

// ─── oauth.ts ─────────────────────────────────────────────────────────────────

void describe("oauth.ts", () => {
  void describe("isGoogleOAuthEnabled", () => {
    void test("returns false when credentials are empty strings (test config)", () => {
      // config.json (copied from sample) has empty clientId/clientSecret
      assert.strictEqual(isGoogleOAuthEnabled(), false);
    });
  });

  void describe("isFacebookOAuthEnabled", () => {
    void test("returns false when credentials are empty strings (test config)", () => {
      assert.strictEqual(isFacebookOAuthEnabled(), false);
    });
  });

  void describe("setOAuthStateCookie", () => {
    void test("returns a non-empty state string", () => {
      const res = mockRes();
      const state = setOAuthStateCookie(res);
      assert.ok(typeof state === "string" && state.length > 0);
    });

    void test("sets the oauth_state cookie with correct options", () => {
      const res = mockRes();
      const state = setOAuthStateCookie(res);

      const cookieEntry = res._cookies["oauth_state"];
      assert.ok(cookieEntry, "oauth_state cookie should be set");
      assert.strictEqual(cookieEntry.value, state);

      const opts = cookieEntry.opts as Record<string, unknown>;
      assert.strictEqual(opts?.httpOnly, true);
      assert.strictEqual(opts?.sameSite, "lax");
      assert.strictEqual(opts?.path, "/oauth");
    });

    void test("returns different state values on each call", () => {
      const res1 = mockRes();
      const res2 = mockRes();
      const state1 = setOAuthStateCookie(res1);
      const state2 = setOAuthStateCookie(res2);
      assert.notStrictEqual(state1, state2);
    });
  });

  void describe("getGoogleOAuthURL", () => {
    void test("returns a valid URL string", () => {
      const url = new URL(getGoogleOAuthURL("test-state"));
      assert.strictEqual(url.hostname, "accounts.google.com");
    });

    void test("includes the state parameter for CSRF protection", () => {
      const url = new URL(getGoogleOAuthURL("my-csrf-state"));
      assert.strictEqual(url.searchParams.get("state"), "my-csrf-state");
    });

    void test("includes required OAuth parameters", () => {
      const url = new URL(getGoogleOAuthURL("s"));
      assert.strictEqual(url.searchParams.get("response_type"), "code");
      assert.strictEqual(url.searchParams.get("scope"), "email profile");
      assert.strictEqual(url.searchParams.get("access_type"), "offline");
    });
  });

  void describe("getFacebookOAuthURL", () => {
    void test("returns a valid URL string", () => {
      const url = new URL(getFacebookOAuthURL("test-state"));
      assert.strictEqual(url.hostname, "www.facebook.com");
    });

    void test("includes the state parameter for CSRF protection", () => {
      const url = new URL(getFacebookOAuthURL("fb-csrf-state"));
      assert.strictEqual(url.searchParams.get("state"), "fb-csrf-state");
    });

    void test("includes required OAuth parameters", () => {
      const url = new URL(getFacebookOAuthURL("s"));
      assert.strictEqual(url.searchParams.get("response_type"), "code");
      assert.ok(url.searchParams.get("scope")?.includes("email"));
    });
  });

  void describe("getGoogleUser", () => {
    afterEach(() => {
      mock.restoreAll();
    });

    void test("returns user data on success", async () => {
      mock.method(globalThis, "fetch", async () =>
        new Response(
          JSON.stringify({ sub: "google-sub-123", name: "Alice", email: "alice@example.com" }),
          { status: 200 }
        )
      );

      const user = await getGoogleUser("fake-access-token");
      assert.strictEqual(user.sub, "google-sub-123");
      assert.strictEqual(user.name, "Alice");
      assert.strictEqual(user.email, "alice@example.com");
    });

    void test("throws when response is not ok", async () => {
      mock.method(globalThis, "fetch", async () => new Response("Unauthorized", { status: 401 }));

      await assert.rejects(() => getGoogleUser("bad-token"), /Failed to fetch user from Google/);
    });

    void test("throws when response body is missing required fields", async () => {
      mock.method(globalThis, "fetch", async () =>
        new Response(JSON.stringify({ sub: "123" }), { status: 200 })
      );

      await assert.rejects(() => getGoogleUser("token"), /Failed to fetch user from Google/);
    });

    void test("throws when response body is not an object", async () => {
      mock.method(globalThis, "fetch", async () =>
        new Response(JSON.stringify("not-an-object"), { status: 200 })
      );

      await assert.rejects(() => getGoogleUser("token"), /Failed to fetch user from Google/);
    });
  });

  void describe("getFacebookUser", () => {
    afterEach(() => {
      mock.restoreAll();
    });

    void test("returns user data on success", async () => {
      mock.method(globalThis, "fetch", async () =>
        new Response(
          JSON.stringify({ id: "fb-id-456", name: "Bob", email: "bob@example.com" }),
          { status: 200 }
        )
      );

      const user = await getFacebookUser("fake-access-token");
      assert.strictEqual(user.id, "fb-id-456");
      assert.strictEqual(user.name, "Bob");
      assert.strictEqual(user.email, "bob@example.com");
    });

    void test("throws when response is not ok", async () => {
      mock.method(globalThis, "fetch", async () => new Response("Forbidden", { status: 403 }));

      await assert.rejects(
        () => getFacebookUser("bad-token"),
        /Failed to fetch user from Facebook/
      );
    });

    void test("throws when response body is missing required fields", async () => {
      mock.method(globalThis, "fetch", async () =>
        new Response(JSON.stringify({ id: "123" }), { status: 200 })
      );

      await assert.rejects(
        () => getFacebookUser("token"),
        /Failed to fetch user from Facebook/
      );
    });

    void test("throws when response body is not an object", async () => {
      mock.method(globalThis, "fetch", async () =>
        new Response(JSON.stringify(null), { status: 200 })
      );

      await assert.rejects(
        () => getFacebookUser("token"),
        /Failed to fetch user from Facebook/
      );
    });
  });
});
