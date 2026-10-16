import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import request from "supertest";
import { createApp } from "../app";
import { bapYearRange, currentBapYear } from "../bapYear";
import { createMember } from "../db/members";
import { getApprovedSubmissionsInDateRange } from "../db/submissions";
import { createTestDatabase, type TestDatabase } from "./helpers/database";
import { createRawSubmissionFixture } from "./helpers/fixtures";

void describe("Annual standings", () => {
  let fixture: TestDatabase;
  let memberId: number;

  beforeEach(async () => {
    fixture = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    memberId = await createMember("annual@example.test", "Annual Breeder");
  });
  afterEach(async () => fixture.cleanup());

  async function submission(
    approvedOn: string | null,
    reproductionDate: string,
    program: "fish" | "plant" | "coral" = "fish"
  ) {
    const id = await createRawSubmissionFixture(fixture.db, {
      memberId,
      submitted: true,
      witnessStatus: "confirmed",
      witnessedBy: memberId,
      approved: approvedOn !== null,
      approvedBy: memberId,
      reproductionDate,
      program,
      points: 10,
      articlePoints: 5,
    });
    await fixture.db.run("UPDATE submissions SET approved_on = ? WHERE id = ?", approvedOn, id);
    return id;
  }

  void test("ranges count approval, not reproduction, and include the start but exclude the next start", async () => {
    const before = await submission("2025-09-01T03:59:59.999Z", "2025-06-01");
    const first = await submission("2025-09-01T04:00:00.000Z", "2025-06-01");
    const last = await submission("2026-09-01T03:59:59.999Z", "2026-06-01");
    const next = await submission("2026-09-01T04:00:00.000Z", "2026-06-01");
    await submission(null, "2026-06-01");
    await submission("2026-05-01T12:00:00.000Z", "2026-01-01", "plant");
    const rows = await getApprovedSubmissionsInDateRange(
      new Date("2025-09-01T04:00:00.000Z"),
      new Date("2026-09-01T04:00:00.000Z"),
      "fish"
    );
    assert.deepEqual(rows.map((row) => row.id).sort(), [first, last].sort());
    assert.equal(
      rows.reduce((total, row) => total + (row.total_points ?? 0), 0),
      30
    );
    const following = await getApprovedSubmissionsInDateRange(
      new Date("2026-09-01T04:00:00.000Z"),
      new Date("2027-09-01T04:00:00.000Z"),
      "fish"
    );
    assert.deepEqual(
      following.map((row) => row.id),
      [next]
    );
    assert.ok(!rows.some((row) => row.id === before));
  });

  void test("equivalent timestamp formats have the same boundary behavior", async () => {
    const included = await submission("2025-09-01T00:00:00-04:00", "2025-06-01");
    const sqliteFormat = await submission("2025-09-01 04:00:00", "2025-06-01");
    await submission("2026-09-01T00:00:00-04:00", "2026-06-01");
    const { start, end } = bapYearRange(2026);
    const rows = await getApprovedSubmissionsInDateRange(start, end, "fish");
    assert.deepEqual(rows.map((row) => row.id).sort(), [included, sqliteFormat].sort());
  });

  void test("the home page, redirect and year picker roll over together without restarting", async (t) => {
    const app = createApp({ env: { NODE_ENV: "test" } });
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-01T03:59:59.999Z") });
    await request(app).get("/annual").expect(302).expect("Location", "/annual/2026");
    let home = await request(app).get("/").expect(200);
    assert.match(home.text, /href="\/annual\/2026">2026<\/a>/);
    assert.doesNotMatch(home.text, /href="\/annual\/2027"/);
    t.mock.timers.tick(1);
    await request(app).get("/annual").expect(302).expect("Location", "/annual/2027");
    await request(app)
      .get("/annual")
      .set("HX-Request", "true")
      .expect(200)
      .expect("HX-Redirect", "/annual/2027");
    home = await request(app).get("/").expect(200);
    assert.match(home.text, /href="\/annual\/2027">2027<\/a>/);
    assert.match(home.text, /href="\/annual\/2026">2026<\/a>/);
    assert.match(home.text, /<option value="2015">2015<\/option>/);
    const standings = await request(app).get("/annual/2026/plant").expect(200);
    assert.match(standings.text, /href="\/annual\/2027\/plant"/);
    assert.match(standings.text, /BAP year 2025–2026/);
    t.mock.timers.setTime(new Date("2026-10-15T12:00:00Z").getTime());
    home = await request(app).get("/").expect(200);
    assert.match(home.text, /href="\/annual\/2027">2027<\/a>/);
    assert.doesNotMatch(home.text, /href="\/annual\/2028"/);
    t.mock.timers.setTime(new Date("2027-01-01T05:00:00Z").getTime());
    await request(app).get("/annual").expect(302).expect("Location", "/annual/2027");
    t.mock.timers.setTime(new Date("2027-09-01T04:00:00Z").getTime());
    await request(app).get("/annual").expect(302).expect("Location", "/annual/2028");
    home = await request(app).get("/").expect(200);
    assert.match(home.text, /href="\/annual\/2028">2028<\/a>/);
    const nextYear = await request(app).get("/annual/2028/fish").expect(200);
    assert.match(nextYear.text, /href="\/annual\/2028\/fish" aria-current="page"/);
    assert.doesNotMatch(nextYear.text, /href="\/annual\/2029\/fish"/);
  });

  void test("annual pages use approval year for every program and leave lifetime totals intact", async () => {
    const app = createApp({ env: { NODE_ENV: "test" } });
    for (const program of ["fish", "plant", "coral"] as const) {
      await submission("2026-09-10T23:00:00Z", "2026-06-01", program);
      const previous = await request(app).get(`/annual/2026/${program}`).expect(200);
      assert.doesNotMatch(previous.text, /Annual Breeder/);
      const current = await request(app).get(`/annual/2027/${program}`).expect(200);
      assert.match(current.text, /Annual Breeder/);
      assert.match(current.text, /<td>15<\/td>/);
      const lifetime = await request(app).get(`/lifetime/${program}`).expect(200);
      assert.match(lifetime.text, /Annual Breeder/);
    }
  });

  void test("explicit historical years work and malformed years are rejected", async () => {
    const app = createApp({ env: { NODE_ENV: "test" } });
    await request(app).get("/annual?year=2020").expect(302).expect("Location", "/annual/2020");
    await request(app)
      .get("/annual?year=2020")
      .set("HX-Request", "true")
      .expect(200)
      .expect("HX-Redirect", "/annual/2020");
    for (const year of ["2014", "2026oops", "2026.5", "10000"]) {
      await request(app).get(`/annual?year=${year}`).expect(422);
      await request(app).get(`/annual/${year}`).expect(422);
    }
    await request(app).get("/annual/2026/unknown").expect(404);
  });

  void test("/annual without a year redirects to a usable standings page", async () => {
    const app = createApp({ env: { NODE_ENV: "test" } });
    const response = await request(app).get("/annual").expect(302);
    assert.match(response.headers.location, /^\/annual\/\d{4}$/);
    await request(app).get(response.headers.location).expect(200);
  });
});

void test("BAP year changes at September midnight in Brooklyn, not at January or UTC midnight", () => {
  const cases: [string, number][] = [
    ["2026-01-01T05:00:00Z", 2026],
    ["2026-07-01T04:00:00Z", 2026],
    ["2026-08-01T04:00:00Z", 2026],
    ["2026-09-01T03:59:59.999Z", 2026],
    ["2026-09-01T04:00:00Z", 2027],
    ["2026-10-14T12:00:00Z", 2027],
    ["2026-12-31T23:59:59Z", 2027],
    ["2027-01-01T05:00:00Z", 2027],
    ["2028-02-29T12:00:00Z", 2028],
    ["2030-09-01T04:00:00Z", 2031],
  ];
  for (const [instant, expected] of cases) {
    assert.equal(currentBapYear(new Date(instant)), expected, instant);
  }
});
