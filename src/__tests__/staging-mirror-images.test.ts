import { describe, test } from "node:test";
import assert from "node:assert";
import { S3Client } from "@aws-sdk/client-s3";
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
});
