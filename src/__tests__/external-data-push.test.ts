/**
 * The external-data pusher (scripts/push-external-data.ts): argument parsing,
 * selection, the per-Species plan, the token file check, and the run against
 * a fake API.
 */
import { describe, test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";
import {
  AuthError,
  diffList,
  type ExternalData,
  loadToken,
  parsePushArgs,
  planPush,
  pushExternalData,
  retryDelayMs,
  selectSpecies,
  SpeciesApi,
  UsageError,
} from "../services/externalDataPush";

function species(overrides: Partial<ExternalData> = {}): ExternalData {
  return {
    group_id: 61,
    canonical_genus: "Betta",
    canonical_species_name: "splendens",
    external_references: ["https://a.example/1"],
    image_links: ["https://img.example/1.jpg"],
    ...overrides,
  };
}

void describe("parsePushArgs", () => {
  void test("is a dry-run unless --execute", () => {
    assert.strictEqual(parsePushArgs(["--all"]).execute, false);
    assert.strictEqual(parsePushArgs(["--all", "--execute"]).execute, true);
  });

  void test("takes exactly one selection", () => {
    assert.deepStrictEqual(parsePushArgs(["--species-id=61"]).selection, {
      kind: "species",
      groupId: 61,
    });
    assert.deepStrictEqual(parsePushArgs(["--since=2026-10-01"]).selection, {
      kind: "since",
      since: "2026-10-01T00:00:00.000Z",
    });
    assert.throws(() => parsePushArgs([]), UsageError);
    assert.throws(() => parsePushArgs(["--all", "--species-id=1"]), UsageError);
  });

  void test("rejects bad values and unknown flags", () => {
    assert.throws(() => parsePushArgs(["--species-id=abc"]), UsageError);
    assert.throws(() => parsePushArgs(["--species-id=0"]), UsageError);
    assert.throws(() => parsePushArgs(["--since=yesterday"]), UsageError);
    assert.throws(() => parsePushArgs(["--all", "--delay-ms=-1"]), UsageError);
    assert.throws(() => parsePushArgs(["--all", "--force"]), UsageError);
  });

  void test("passes --db, --url and --delay-ms through", () => {
    const options = parsePushArgs([
      "--all",
      "--db=/tmp/x.db",
      "--url=https://x.example",
      "--delay-ms=0",
    ]);
    assert.strictEqual(options.dbPath, "/tmp/x.db");
    assert.strictEqual(options.url, "https://x.example");
    assert.strictEqual(options.delayMs, 0);
  });
});

void describe("selectSpecies", () => {
  const rows = [
    {
      group_id: 3,
      canonical_genus: "C",
      canonical_species_name: "c",
      last_external_sync: "2026-10-02T08:00:00.000Z",
    },
    { group_id: 1, canonical_genus: "A", canonical_species_name: "a", last_external_sync: null },
    {
      group_id: 2,
      canonical_genus: "B",
      canonical_species_name: "b",
      last_external_sync: "2026-09-30 23:59:59",
    },
    {
      group_id: 4,
      canonical_genus: "D",
      canonical_species_name: "d",
      last_external_sync: "2026-10-01 00:00:00",
    },
  ];
  const ids = (selection: Parameters<typeof selectSpecies>[1]) =>
    selectSpecies(rows, selection).map((r) => r.group_id);

  void test("picks one id, every row, or rows synced at or after --since, in id order", () => {
    assert.deepStrictEqual(ids({ kind: "species", groupId: 2 }), [2]);
    assert.deepStrictEqual(ids({ kind: "species", groupId: 9 }), []);
    assert.deepStrictEqual(ids({ kind: "all" }), [1, 2, 3, 4]);
    assert.deepStrictEqual(ids({ kind: "since", since: "2026-10-01T00:00:00.000Z" }), [3, 4]);
  });
});

void describe("diffList", () => {
  void test("is null for the same list in the same order", () => {
    assert.strictEqual(diffList(["a", "b"], ["a", "b"]), null);
  });
  void test("reports additions, removals and reorders", () => {
    assert.deepStrictEqual(diffList(["a", "b"], ["b", "c"]), {
      added: ["c"],
      removed: ["a"],
      reordered: false,
    });
    assert.deepStrictEqual(diffList(["a", "b"], ["b", "a"]), {
      added: [],
      removed: [],
      reordered: true,
    });
  });
});

void describe("planPush", () => {
  void test("leaves a matching Species alone", () => {
    assert.deepStrictEqual(planPush(species(), species()), { action: "unchanged" });
  });

  void test("updates when either list differs", () => {
    const plan = planPush(species({ image_links: ["https://img.example/2.jpg"] }), species());
    assert.strictEqual(plan.action, "update");
    assert.ok(plan.action === "update" && plan.images && plan.references === null);
  });

  void test("skips a Species whose Canonical name differs on the remote", () => {
    const plan = planPush(
      species({ external_references: ["https://a.example/new"] }),
      species({ canonical_genus: "Trichopodus", canonical_species_name: "trichopterus" })
    );
    assert.strictEqual(plan.action, "skip");
    assert.match(plan.action === "skip" ? plan.reason : "", /name mismatch/);
  });

  void test("ignores case and surrounding space in the name", () => {
    assert.deepStrictEqual(planPush(species({ canonical_genus: " betta" }), species()), {
      action: "unchanged",
    });
  });

  void test("refuses to empty a list the remote has", () => {
    const plan = planPush(species({ image_links: [] }), species());
    assert.deepStrictEqual(plan, { action: "skip", reason: "would clear remote image_links" });
  });
});

void describe("loadToken", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "push-token-"));
  const file = path.join(dir, "admin-token");

  void test("prefers BASNY_ADMIN_TOKEN", () => {
    assert.strictEqual(loadToken({ BASNY_ADMIN_TOKEN: " basny_env \n" }, file), "basny_env");
  });

  void test("reads a mode-600 file and refuses a looser one", () => {
    fs.writeFileSync(file, "basny_file\n", { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    assert.strictEqual(loadToken({}, file), "basny_file");
    fs.chmodSync(file, 0o640);
    assert.throws(() => loadToken({}, file), /readable by group or others/);
    fs.rmSync(dir, { recursive: true });
    assert.throws(() => loadToken({}, file), /No admin token/);
  });
});

void describe("retryDelayMs", () => {
  void test("honours Retry-After, else backs off", () => {
    assert.strictEqual(retryDelayMs("10", 0), 10250);
    assert.strictEqual(retryDelayMs(null, 0), 5000);
    assert.strictEqual(retryDelayMs(null, 2), 20000);
  });
});

/** A remote holding `held`, recording each request. */
function fakeRemote(held: Record<number, ExternalData>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const pathname = new URL(url).pathname;
    calls.push(`${method} ${pathname}`);
    const auth = (init?.headers as Record<string, string>).Authorization;
    if (auth !== "Bearer basny_test")
      return Response.json({ error: "unauthorized" }, { status: 401 });
    const id = Number(pathname.split("/")[4]);
    if (!held[id]) return Response.json({ error: "not_found", message: "nope" }, { status: 404 });
    if (method === "PUT") {
      const body = JSON.parse(init?.body as string) as Pick<
        ExternalData,
        "external_references" | "image_links"
      >;
      held[id] = { ...held[id], ...body };
      return Response.json({
        group_id: id,
        ...body,
        last_external_sync: "2026-10-28T00:00:00.000Z",
      });
    }
    return Response.json({ ...held[id], names: { common: [], scientific: [] } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const noSleep = () => Promise.resolve();

void describe("pushExternalData", () => {
  const locals = () => [
    species({ group_id: 1, external_references: ["https://a.example/new"] }),
    species({ group_id: 2 }),
    species({ group_id: 3, canonical_genus: "Old" }),
    species({ group_id: 4 }),
  ];
  const remote = () => ({
    1: species({ group_id: 1 }),
    2: species({ group_id: 2 }),
    3: species({ group_id: 3 }),
  });

  void test("dry-run writes nothing and counts what it would do", async () => {
    const { calls, fetchImpl } = fakeRemote(remote());
    const lines: string[] = [];
    const api = new SpeciesApi("https://x.example/", "basny_test", 0, fetchImpl, noSleep);
    const summary = await pushExternalData(locals(), api, false, (l) => lines.push(l));
    assert.deepStrictEqual(summary, {
      checked: 4,
      unchanged: 1,
      updated: 1,
      skipped: 2,
      failed: 0,
    });
    assert.ok(calls.every((c) => c.startsWith("GET ")));
    assert.ok(lines.some((l) => l.includes("ref + https://a.example/new")));
    assert.ok(lines.some((l) => l.includes("4 Betta splendens: not on the remote")));
    assert.ok(lines.some((l) => l.includes("name mismatch")));
  });

  void test("execute PUTs only the Species that differs, then a rerun finds it unchanged", async () => {
    const held = remote();
    const { calls, fetchImpl } = fakeRemote(held);
    const api = new SpeciesApi("https://x.example", "basny_test", 0, fetchImpl, noSleep);
    const first = await pushExternalData(locals(), api, true, () => {});
    assert.strictEqual(first.updated, 1);
    assert.deepStrictEqual(
      calls.filter((c) => c.startsWith("PUT")),
      ["PUT /api/admin/species/1/external-data"]
    );
    assert.deepStrictEqual(held[1].external_references, ["https://a.example/new"]);
    const again = await pushExternalData(locals(), api, true, () => {});
    assert.deepStrictEqual(again, { checked: 4, unchanged: 2, updated: 0, skipped: 2, failed: 0 });
  });

  void test("counts a failing Species and carries on", async () => {
    const fetchImpl = (async (url: string) =>
      url.endsWith("/1")
        ? new Response("boom", { status: 500 })
        : Response.json(species({ group_id: 2 }))) as unknown as typeof fetch;
    const api = new SpeciesApi("https://x.example", "basny_test", 0, fetchImpl, noSleep);
    const summary = await pushExternalData(
      [species({ group_id: 1 }), species({ group_id: 2 })],
      api,
      false,
      () => {}
    );
    assert.deepStrictEqual(summary, {
      checked: 2,
      unchanged: 1,
      updated: 0,
      skipped: 0,
      failed: 1,
    });
  });

  void test("stops on a rejected token", async () => {
    const { fetchImpl } = fakeRemote(remote());
    const api = new SpeciesApi("https://x.example", "basny_wrong", 0, fetchImpl, noSleep);
    await assert.rejects(
      pushExternalData(locals(), api, false, () => {}),
      AuthError
    );
  });
});

void describe("SpeciesApi pacing", () => {
  void test("retries a 429 after Retry-After and spaces requests by the delay", async () => {
    let n = 0;
    const fetchImpl = (async () =>
      n++ === 0
        ? new Response("{}", { status: 429, headers: { "Retry-After": "3" } })
        : Response.json(species())) as typeof fetch;
    const sleeps: number[] = [];
    let clock = 0;
    const api = new SpeciesApi(
      "https://x.example",
      "basny_test",
      600,
      fetchImpl,
      (ms) => {
        sleeps.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      () => clock
    );
    assert.ok(await api.get(61));
    assert.deepStrictEqual(sleeps, [3250]);
    await api.get(61);
    assert.deepStrictEqual(sleeps, [3250, 600]);
  });
});
