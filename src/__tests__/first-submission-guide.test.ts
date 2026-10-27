import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import request from "supertest";
import { createApp } from "../app";
import { createMember } from "../db/members";
import { createTestDatabase, type TestDatabase } from "./helpers/database";

/** #563: the first-Submission guide is public and linked from Home and the form. */
void describe("first-Submission guide", () => {
  let fixture: TestDatabase;
  const email = "guide@example.test";
  const password = "Good test password 42!";
  beforeEach(async () => {
    fixture = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    await createMember(email, "Guide Member", { password });
  });
  afterEach(async () => fixture.cleanup());

  void test("is readable before sign-in and covers the lifecycle for every Program", async () => {
    const agent = request.agent(createApp({ env: { NODE_ENV: "test" } }));
    const res = await agent.get("/guide").expect(200);
    for (const heading of ["Choose a Program and a Species", "The Witness", "The waiting period", "Bring it to a meeting", "Questions and corrections"]) {
      assert.match(res.text, new RegExp(heading));
    }
    for (const program of ["BAP", "HAP", "CAP"]) {
      assert.match(res.text, new RegExp(`${program}: a`), `${program} example`);
    }
    assert.match(res.text, /30 days for marine fish/);
    assert.match(res.text, /60 days for everything else/);
    assert.match(res.text, /href="https:\/\/www.basny.org\/Documents\/BAP\/BAS-BAP-Manual.pdf"/);
    assert.doesNotMatch(res.text, /href="\/submissions\/new"/, "anonymous viewers are told to log in instead");
  });

  void test("Home links to it, and a signed-in member reaches it from the form and back to the form", async () => {
    const agent = request.agent(createApp({ env: { NODE_ENV: "test" } }));
    const home = await agent.get("/").expect(200);
    assert.match(home.text, /<a class="link font-extrabold" href="\/guide">\[Your First Submission\]<\/a>/);

    await agent
      .post("/auth/login")
      .set("Origin", "http://localhost:4200")
      .type("form")
      .send({ email, password })
      .expect(200);
    const form = await agent.get("/submissions/new").expect(200);
    assert.match(form.text, /id="first-submission-guide-link" href="\/guide">Read the first-submission guide</);
    const guide = await agent.get("/guide").expect(200);
    assert.match(guide.text, /href="\/submissions\/new">Start a new species submission</);
  });
});
