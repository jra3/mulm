/**
 * Mint, list and revoke admin API tokens (#595). See docs/ADMIN_API.md.
 *
 *   admin-token mint --member <id|email> --name <label> [--expires-days N]
 *   admin-token list
 *   admin-token revoke <id>
 *
 * It lives under src/ so `npm run build` compiles it into the image as
 * /app/src/cli/admin-token.js (the runner stage copies dist/src and installs
 * no devDependencies, so tsx and scripts/ are not there). Run it on a Fly
 * machine as the nodejs user the app runs as, so the database files stay its:
 *
 *   flyctl ssh console --app basny-bap -C "su nodejs -s /bin/sh -c 'cd /app && node src/cli/admin-token.js list'"
 *
 * Locally, against the configured database: `npm run admin-token -- list`.
 * `mint` prints the token once, on stdout, and nowhere else.
 */
import { addAlias } from "module-alias";
import path from "path";
addAlias("@", path.join(__dirname, ".."));

import { parseArgs } from "node:util";
import { z } from "zod";
import { closeConnections, ensureReady } from "@/db/conn";
import { getMember, getMemberByEmail } from "@/db/members";
import {
  AdminTokenError,
  createAdminToken,
  listAdminTokens,
  revokeAdminToken,
} from "@/db/adminTokens";

const USAGE = `Usage:
  admin-token mint --member <id|email> --name <label> [--expires-days N]
  admin-token list
  admin-token revoke <id>`;

class UsageError extends Error {}

const positiveInt = (what: string) =>
  z
    .string()
    .regex(/^\d+$/, `${what} must be a positive whole number`)
    .transform(Number)
    .refine((n) => n > 0, `${what} must be a positive whole number`);

const mintArgs = z.object({
  member: z.string().trim().min(1, "--member is required"),
  name: z.string().trim().min(1, "--name is required"),
  "expires-days": positiveInt("--expires-days").optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new UsageError(result.error.issues[0].message);
  return result.data;
}

async function findMember(ref: string) {
  const member = /^\d+$/.test(ref) ? await getMember(Number(ref)) : await getMemberByEmail(ref);
  if (!member) throw new AdminTokenError(`No member matches ${ref}`);
  return member;
}

async function mint(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      member: { type: "string" },
      name: { type: "string" },
      "expires-days": { type: "string" },
    },
  });
  const args = parse(mintArgs, values);
  const member = await findMember(args.member);
  const { token, record } = await createAdminToken(member.id, args.name, {
    expiresInDays: args["expires-days"],
  });
  console.error(
    `Minted token ${record.id} "${record.name}" for ${member.display_name} (member ${member.id}), ` +
      `expires ${record.expires_at ?? "never"}. It is shown once:`
  );
  console.log(token);
}

async function list(argv: string[]) {
  parseArgs({ args: argv, options: {} });
  const tokens = await listAdminTokens();
  if (tokens.length === 0) {
    console.log("No admin API tokens.");
    return;
  }
  for (const t of tokens) {
    const state = t.revoked_at
      ? `revoked ${t.revoked_at}`
      : t.expires_at && t.expires_at <= new Date().toISOString()
        ? `expired ${t.expires_at}`
        : "active";
    console.log(
      [
        `#${t.id}`,
        JSON.stringify(t.name),
        `${t.display_name} <${t.contact_email}> (member ${t.member_id})`,
        `created ${t.created_at}`,
        `last used ${t.last_used_at ?? "never"}`,
        `expires ${t.expires_at ?? "never"}`,
        state,
      ].join("  ")
    );
  }
}

async function revoke(argv: string[]) {
  const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true });
  if (positionals.length !== 1) throw new UsageError("revoke takes exactly one token id");
  const id = parse(positiveInt("Token id"), positionals[0]);
  if (!(await revokeAdminToken(id))) {
    throw new AdminTokenError(`No active token with id ${id}`);
  }
  console.log(`Revoked token ${id}.`);
}

const commands: Record<string, (argv: string[]) => Promise<void>> = { mint, list, revoke };

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  const run = commands[command];
  if (!run) {
    console.error(`Unknown command: ${command}\n${USAGE}`);
    return 1;
  }
  await ensureReady();
  try {
    await run(rest);
    return 0;
  } catch (err) {
    if (err instanceof UsageError || err instanceof AdminTokenError) {
      console.error(err.message);
      if (err instanceof UsageError) console.error(USAGE);
      return 1;
    }
    if (
      err instanceof TypeError &&
      "code" in err &&
      String(err.code).startsWith("ERR_PARSE_ARGS")
    ) {
      console.error(`${err.message}\n${USAGE}`);
      return 1;
    }
    throw err;
  } finally {
    await closeConnections();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  }
);
