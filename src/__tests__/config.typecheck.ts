// Compile-time checks only: npm run typecheck includes this file; npm test does not.
import type aliasConfig from "@/config.json";
import type relativeConfig from "../config.json";
import type sampleConfig from "../config.sample.json";
import type { Config } from "@/config.json";

type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type ConfigChecks = [
  Assert<Same<typeof aliasConfig, Config>>,
  Assert<Same<typeof relativeConfig, Config>>,
  Assert<typeof sampleConfig extends Config ? true : false>,
];
