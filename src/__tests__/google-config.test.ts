import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import config from "@/config.json";
import { getGoogleOAuthURL, isGoogleOAuthEnabled, translateGoogleOAuthCode } from "@/oauth";

const originalOauth = config.oauth;
afterEach(() => {
  config.oauth = originalOauth;
});

void test("Google OAuth refuses absent or incomplete optional configuration before fetching", async () => {
  for (const oauth of [undefined, {}, { google: { clientId: "client", clientSecret: "" } }]) {
    config.oauth = oauth;
    assert.equal(isGoogleOAuthEnabled(), false);
    assert.throws(() => getGoogleOAuthURL("state"), /Google OAuth is not configured/);
    await assert.rejects(translateGoogleOAuthCode("code"), /Google OAuth is not configured/);
  }
});

void test("configured Google OAuth builds the provider URL", () => {
  config.oauth = { google: { clientId: "sample-client", clientSecret: "sample-secret" } };
  assert.equal(isGoogleOAuthEnabled(), true);
  const url = new URL(getGoogleOAuthURL("sample-state"));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), "sample-client");
  assert.equal(url.searchParams.get("state"), "sample-state");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    `https://${config.server.domain}/oauth/google`
  );
});
