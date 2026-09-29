/**
 * Sign in with Apple (#442): the client-secret JWT, id_token verification,
 * the once-only name, the state cookie and the link-or-create policy.
 */
import { describe, test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { generateKeyPair, exportPKCS8, importPKCS8, jwtVerify, SignJWT, type CryptoKey } from "jose";
import type { Response } from "express";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  APPLE_ISSUER,
  appleUserName,
  buildAppleClientSecret,
  getAppleOAuthURL,
  resolveAppleMember,
  verifyAppleIdToken,
  type AppleConfig,
  type AppleIdentity,
} from "@/auth/apple";
import { setOAuthStateCookie, clearOAuthStateCookie, beginOAuthFlow, takeOAuthLinkMember } from "@/oauth";
import { createAppleOAuthHandler } from "@/routes/auth";
import { query } from "@/db/conn";
import { setupTestDatabase, type TestDatabase } from "./testDbHelper.helper";
import { createMember, getAppleAccountByMemberId, getMember, getMemberByEmail } from "@/db/members";

let cfg: AppleConfig;
let publicKey: CryptoKey;

before(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  publicKey = pair.publicKey;
  cfg = {
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    servicesId: "org.basny.web",
    privateKey: await exportPKCS8(pair.privateKey),
  };
});

void describe("Apple client secret", () => {
  void test("is an ES256 JWT with the claims Apple checks", async () => {
    const now = new Date("2026-09-29T12:00:00Z");
    const secret = await buildAppleClientSecret(cfg, now);
    const { payload, protectedHeader } = await jwtVerify(secret, publicKey, {
      issuer: cfg.teamId,
      audience: APPLE_ISSUER,
      subject: cfg.servicesId,
      currentDate: now,
    });
    assert.strictEqual(protectedHeader.alg, "ES256");
    assert.strictEqual(protectedHeader.kid, cfg.keyId);
    assert.strictEqual(payload.iat, 1790683200);
    assert.strictEqual(payload.exp, 1790683200 + 600);
  });
});

void describe("Apple authorize URL", () => {
  void test("asks for name and email by form_post with the state", () => {
    const url = new URL(getAppleOAuthURL("abc123", cfg));
    assert.strictEqual(url.origin + url.pathname, "https://appleid.apple.com/auth/authorize");
    assert.strictEqual(url.searchParams.get("client_id"), "org.basny.web");
    assert.strictEqual(url.searchParams.get("response_type"), "code");
    assert.strictEqual(url.searchParams.get("response_mode"), "form_post");
    assert.strictEqual(url.searchParams.get("scope"), "name email");
    assert.strictEqual(url.searchParams.get("state"), "abc123");
    assert.match(url.searchParams.get("redirect_uri") ?? "", /^https:\/\/.+\/oauth\/apple$/);
  });
});

async function signIdToken(
  claims: Record<string, unknown>,
  privateKeyPem = cfg.privateKey,
  audience = cfg.servicesId
) {
  const key = await importPKCS8(privateKeyPem, "ES256");
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: cfg.keyId })
    .setIssuer(APPLE_ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

void describe("Apple id_token verification", () => {
  const getKey = () => Promise.resolve(publicKey);

  void test("reads sub, email and the string-encoded booleans", async () => {
    const token = await signIdToken({
      sub: "001234.abcdef.5678",
      email: "fish@example.com",
      email_verified: "true",
      is_private_email: "false",
    });
    const identity = await verifyAppleIdToken(token, cfg, getKey);
    assert.deepStrictEqual(identity, {
      sub: "001234.abcdef.5678",
      email: "fish@example.com",
      emailVerified: true,
      isPrivateEmail: false,
    });
  });

  void test("flags a Hide My Email relay address even without the claim", async () => {
    const token = await signIdToken({
      sub: "001234.relay.0001",
      email: "x9k2p@privaterelay.appleid.com",
      email_verified: true,
    });
    const identity = await verifyAppleIdToken(token, cfg, getKey);
    assert.strictEqual(identity.isPrivateEmail, true);
  });

  void test("rejects a token minted for another client", async () => {
    const token = await signIdToken(
      { sub: "001234.other", email: "fish@example.com" },
      cfg.privateKey,
      "com.someone.else"
    );
    await assert.rejects(verifyAppleIdToken(token, cfg, getKey));
  });

  void test("rejects a token signed by another key", async () => {
    const other = await generateKeyPair("ES256", { extractable: true });
    const token = await signIdToken(
      { sub: "001234.forged", email: "fish@example.com" },
      await exportPKCS8(other.privateKey)
    );
    await assert.rejects(verifyAppleIdToken(token, cfg, getKey));
  });
});

void describe("Apple user name", () => {
  void test("joins the first-authorization name", () => {
    const user = JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" }, email: "a@b.c" });
    assert.strictEqual(appleUserName(user, "a@b.c"), "Ada Lovelace");
  });

  void test("falls back to the email local part when the name is missing or empty", () => {
    assert.strictEqual(appleUserName(undefined, "ada.l@example.com"), "ada.l");
    assert.strictEqual(appleUserName(JSON.stringify({ name: { firstName: " " } }), "ada@x.y"), "ada");
    assert.strictEqual(appleUserName("not json", "ada@x.y"), "ada");
  });
});

void describe("OAuth state cookie", () => {
  function fakeResponse() {
    const calls: { name: string; value?: string; options: Record<string, unknown> }[] = [];
    const res = {
      cookie(name: string, value: string, options: Record<string, unknown>) {
        calls.push({ name, value, options });
        return res;
      },
      clearCookie(name: string, options: Record<string, unknown>) {
        calls.push({ name, options });
        return res;
      },
    };
    return { res: res as unknown as Response, calls };
  }

  void test("survives a cross-site POST: SameSite=None, Secure, scoped to /oauth", () => {
    const { res, calls } = fakeResponse();
    const state = setOAuthStateCookie(res);
    assert.strictEqual(calls[0]?.name, "oauth_state");
    assert.strictEqual(calls[0]?.value, state);
    assert.strictEqual(calls[0]?.options.sameSite, "none");
    assert.strictEqual(calls[0]?.options.secure, true);
    assert.strictEqual(calls[0]?.options.httpOnly, true);
    assert.strictEqual(calls[0]?.options.path, "/oauth");
  });

  void test("is cleared on the path it was set on, or the browser keeps it", () => {
    const { res, calls } = fakeResponse();
    clearOAuthStateCookie(res);
    assert.strictEqual(calls[0]?.name, "oauth_state");
    assert.strictEqual(calls[0]?.options.path, "/oauth");
  });
});

void describe("Apple member resolution", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
  });
  afterEach(async () => {
    await testDb.cleanup();
  });

  const identity = (sub: string, email: string): AppleIdentity => ({
    sub,
    email,
    emailVerified: true,
    isPrivateEmail: email.endsWith("@privaterelay.appleid.com"),
  });

  void test("creates a member for an unknown identity and links it", async () => {
    const id = await resolveAppleMember(identity("001.new", "new@example.com"), "New Person");
    const member = await getMember(id);
    assert.strictEqual(member?.display_name, "New Person");
    assert.strictEqual(member?.contact_email, "new@example.com");
    assert.strictEqual((await getAppleAccountByMemberId(id))?.apple_sub, "001.new");
  });

  void test("links to the existing member with that email, whatever its case", async () => {
    const existing = await createMember("Ada@Example.com", "Ada");
    const id = await resolveAppleMember(identity("001.ada", "ada@example.com"), "ignored");
    assert.strictEqual(id, existing);
    assert.strictEqual((await getMember(id))?.display_name, "Ada");
  });

  void test("a known sub logs in without touching the member", async () => {
    const first = await resolveAppleMember(identity("001.same", "same@example.com"), "Same");
    const again = await resolveAppleMember(identity("001.same", "changed@example.com"), "Other");
    assert.strictEqual(again, first);
    assert.strictEqual((await getMember(first))?.contact_email, "same@example.com");
  });

  void test("a logged-in viewer links their own account, not one matching the email", async () => {
    const viewer = await createMember("viewer@example.com", "Viewer");
    const other = await createMember("apple@example.com", "Other");
    const id = await resolveAppleMember(identity("001.viewer", "apple@example.com"), "x", viewer);
    assert.strictEqual(id, viewer);
    assert.strictEqual(await getAppleAccountByMemberId(other), undefined);
  });

  void test("an unverified address cannot claim an existing member", async () => {
    await createMember("real@example.com", "Real");
    await assert.rejects(
      resolveAppleMember({ ...identity("001.unverified", "real@example.com"), emailVerified: false }, "x")
    );
    assert.strictEqual(await getAppleAccountByMemberId(1), undefined);
  });

  void test("a relay address never matches, so it becomes a new member", async () => {
    await createMember("real@example.com", "Real");
    const id = await resolveAppleMember(
      identity("001.relay", "k3j2h@privaterelay.appleid.com"),
      appleUserName(undefined, "k3j2h@privaterelay.appleid.com")
    );
    const member = await getMemberByEmail("k3j2h@privaterelay.appleid.com");
    assert.strictEqual(member?.id, id);
    assert.strictEqual(member?.display_name, "k3j2h");
  });
});

void describe("Apple callback without the session cookie", () => {
  let testDb: TestDatabase;
  beforeEach(async () => {
    testDb = await setupTestDatabase();
  });
  afterEach(async () => {
    await testDb.cleanup();
  });

  function fakeResponse() {
    const cookies: Record<string, string> = {};
    const res = {
      cookie(name: string, value: string) {
        cookies[name] = value;
        return res;
      },
    };
    return { res: res as unknown as Response, cookies };
  }

  void test("links the member who started the flow, via the state binding", async () => {
    const member = await createMember("starter@example.com", "Starter");
    const { res, cookies } = fakeResponse();
    const state = await beginOAuthFlow(res, member);
    assert.strictEqual(cookies.oauth_state, state);
    assert.strictEqual(await takeOAuthLinkMember(state), member);
    // One-shot.
    assert.strictEqual(await takeOAuthLinkMember(state), undefined);
  });

  void test("an anonymous start binds nobody", async () => {
    const { res } = fakeResponse();
    const state = await beginOAuthFlow(res);
    assert.strictEqual(await takeOAuthLinkMember(state), undefined);
  });

  void test("an expired binding is ignored", async () => {
    const member = await createMember("late@example.com", "Late");
    const { res } = fakeResponse();
    const state = await beginOAuthFlow(res, member);
    await query("UPDATE auth_codes SET expires_on = ? WHERE code = ?", [
      new Date(Date.now() - 60_000).toISOString(),
      state,
    ]);
    assert.strictEqual(await takeOAuthLinkMember(state), undefined);
  });

  void test("the cross-site POST links the originating member with no session cookie sent", async () => {
    const member = await createMember("linker@example.com", "Linker", { password: "Str0ng!Passw0rd" });

    // Start the flow as the signed-in member: state cookie + binding.
    const { res, cookies } = fakeResponse();
    const state = await beginOAuthFlow(res, member);

    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser());
    // No session middleware: exactly what a SameSite=Lax session cookie
    // dropped on a cross-site POST looks like to the server.
    app.post(
      "/oauth/apple",
      createAppleOAuthHandler({
        config: () => cfg,
        exchange: () => Promise.resolve("id-token"),
        verify: () =>
          Promise.resolve({
            sub: "001.linker",
            email: "other-address@privaterelay.appleid.com",
            emailVerified: true,
            isPrivateEmail: true,
          }),
      })
    );

    const response = await request(app)
      .post("/oauth/apple")
      .set("Cookie", `oauth_state=${cookies.oauth_state}`)
      .type("form")
      .send({ code: "apple-code", state });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, "/");
    assert.strictEqual((await getAppleAccountByMemberId(member))?.apple_sub, "001.linker");
    // No second member was created for the relay address.
    assert.strictEqual(await getMemberByEmail("other-address@privaterelay.appleid.com"), undefined);
  });
});
