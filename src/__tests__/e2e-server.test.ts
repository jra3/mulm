import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { access } from "node:fs/promises";
import globalSetup from "../../e2e/global-setup";
import { startWorkerPortal } from "../../e2e/helpers/portal";
import { ensureTestUserExists, getTestDatabase } from "../../e2e/helpers/testData";

void test("the owned Portal uses the helpers' database and never selects an unrelated server", async () => {
  let unrelatedRequests = 0;
  const unrelated = createServer((_request, response) => {
    unrelatedRequests++;
    response.end("unrelated server");
  });
  unrelated.listen(0, "127.0.0.1");
  await once(unrelated, "listening");
  const address = unrelated.address();
  assert.ok(address && typeof address !== "string");
  const unrelatedURL = `http://127.0.0.1:${address.port}`;
  const previousURL = process.env.BASE_URL;
  process.env.BASE_URL = unrelatedURL;
  const cleanupRun = await globalSetup();
  const directory = process.env.MULM_E2E_DIRECTORY!;
  try {
    const portal = await startWorkerPortal();
    const filename = process.env.MULM_E2E_DATABASE!;
    try {
      assert.notEqual(portal.baseURL, unrelatedURL);
      const id = await ensureTestUserExists(
        "same-file@example.invalid",
        "password",
        "Shared File Proof"
      );
      const response = await fetch(`${portal.baseURL}/member/${id}`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Shared File Proof/);
      const connection = await getTestDatabase();
      try {
        const files = await connection.all<{ file: string }[]>("PRAGMA database_list");
        assert.equal(files[0].file, filename);
      } finally {
        await connection.close();
      }
      assert.equal(unrelatedRequests, 0);
    } finally {
      await portal.stop();
    }
    await assert.rejects(access(filename), { code: "ENOENT" });
    assert.equal(await (await fetch(unrelatedURL)).text(), "unrelated server");
  } finally {
    await cleanupRun();
    unrelated.close();
    await once(unrelated, "close");
    if (previousURL === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = previousURL;
  }
  await assert.rejects(access(directory), { code: "ENOENT" });
});
