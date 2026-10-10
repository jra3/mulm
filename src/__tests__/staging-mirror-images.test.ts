import { describe, test } from "node:test";
import assert from "node:assert";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { planMirror, mirrorBucket } from "../staging/mirrorImages";

const obj = (key: string, size = 10, etag = `"${key}"`) => ({ key, size, etag });

void describe("planMirror", () => {
  void test("copies objects missing from dest", () => {
    const plan = planMirror([obj("a"), obj("b")], [obj("a")]);
    assert.deepStrictEqual(plan, { copy: ["b"], remove: [] });
  });

  void test("copies objects whose size or etag changed", () => {
    const plan = planMirror([obj("a", 10), obj("b", 10, '"new"')], [obj("a", 9), obj("b", 10)]);
    assert.deepStrictEqual(plan.copy, ["a", "b"]);
  });

  void test("removes dest-only objects, such as staging test uploads", () => {
    const plan = planMirror([obj("a")], [obj("a"), obj("submissions/25/0/test.jpg")]);
    assert.deepStrictEqual(plan, { copy: [], remove: ["submissions/25/0/test.jpg"] });
  });

  void test("identical buckets need nothing", () => {
    assert.deepStrictEqual(planMirror([obj("a")], [obj("a")]), { copy: [], remove: [] });
  });
});

void describe("mirrorBucket", () => {
  void test("refuses to mirror a bucket onto itself", async () => {
    const client = new S3Client({ region: "auto" });
    await assert.rejects(
      mirrorBucket({ client, bucket: "basny-bap-data" }, { client, bucket: "basny-bap-data" }),
      /onto itself/
    );
  });

  void test("counts keys DeleteObjects reports in Errors as failed, not removed", async () => {
    const source = new S3Client({ region: "auto" });
    const dest = new S3Client({ region: "auto" });
    source.send = (async () => ({ Contents: [] })) as typeof source.send;
    dest.send = (async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [obj("x"), obj("y")].map((o) => ({ Key: o.key, Size: o.size, ETag: o.etag })) };
      }
      if (command instanceof DeleteObjectsCommand) {
        return { Deleted: [{ Key: "x" }], Errors: [{ Key: "y", Code: "AccessDenied" }] };
      }
      throw new Error("unexpected command");
    }) as typeof dest.send;

    const result = await mirrorBucket(
      { client: source, bucket: "basny-bap-data" },
      { client: dest, bucket: "basny-bap-staging-data" }
    );
    assert.deepStrictEqual(result, { copied: 0, removed: 1, failed: 1 });
  });
});
