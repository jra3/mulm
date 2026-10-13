import assert from "node:assert/strict";
import { createApp } from "../../../app";
import { bootstrap } from "../../../bootstrap";
import { db } from "../../../db/conn";
import { isR2Enabled } from "../../../utils/r2-client";

assert.equal(typeof bootstrap, "function");
assert.throws(() => db(), /not initialized/);
assert.equal(isR2Enabled(), false);
const app = createApp({ env: { NODE_ENV: "test" } });
assert.equal(app.get("view engine"), "pug");
assert.throws(() => db(), /not initialized/);
assert.equal(isR2Enabled(), false);
console.log("APP_CONSTRUCTION_COMPLETE");
// Natural exit is deliberate: a listener or a scheduled job would keep this
// subprocess alive and trip the parent's timeout.
