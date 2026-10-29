/**
 * Submission endpoints of the admin API (#595), mounted at /api/admin/submissions:
 * find Submissions, and correct an approved or witnessed one's Species and points
 * through `lifecycle.correctPoints`. See the Submissions section of docs/ADMIN_API.md.
 */
import express, { type Response } from "express";
import { z } from "zod";
import { query } from "@/db/conn";
import type { Submission } from "@/db/submissions";
import * as lifecycle from "@/lifecycle";
import { canonicalName, findSpeciesById } from "@/species";
import { adminApiActor, sendApiError, type AdminApiRequest } from "@/middleware/adminApiAuth";

const router = express.Router();

const id = z.coerce.number().int().positive();
const count = z.coerce.number().int().nonnegative();
/** A query-string boolean: only `true` or `false`. */
const flag = z.enum(["true", "false"]).transform((v) => v === "true");
const states = [
  "draft",
  "pendingWitness",
  "waitingPeriod",
  "inApprovalQueue",
  "approved",
] as const satisfies readonly lifecycle.SubmissionState[];

/** Parse `input` or answer 400 with every issue; undefined means a response was sent. */
function parse<S extends z.ZodType>(
  schema: S,
  input: unknown,
  res: Response
): z.output<S> | undefined {
  const parsed = schema.safeParse(input ?? {});
  if (parsed.success) return parsed.data;
  sendApiError(
    res,
    400,
    "bad_request",
    parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ")
  );
  return undefined;
}

const idParams = z.object({ id });

function submissionNotFound(res: Response, submissionId: number) {
  sendApiError(res, 404, "not_found", `Submission ${submissionId} not found`);
}

type Row = Submission & { member_name: string | null };

/** A Submission as the list shows it, with its derived state. */
function summary(row: Row) {
  return {
    id: row.id,
    member_id: row.member_id,
    member_name: row.member_name,
    state: lifecycle.deriveState(row),
    species_common_name: row.species_common_name,
    species_latin_name: row.species_latin_name,
    species_id: row.species_id,
    species_type: row.species_type,
    species_class: row.species_class,
    program: row.program,
    points: row.points,
    submitted_on: row.submitted_on,
    witnessed_on: row.witnessed_on,
    approved_on: row.approved_on,
  };
}

/** One Submission with its points fields and the Canonical name of the Species it is bound to. */
async function detail(row: Row) {
  const species = row.species_id == null ? undefined : await findSpeciesById(row.species_id);
  return {
    ...summary(row),
    species_canonical_name: species ? canonicalName(species) : null,
    article_points: row.article_points || null,
    cares_species: Boolean(row.cares_species),
    flowered: Boolean(row.flowered),
    sexual_reproduction: Boolean(row.sexual_reproduction),
    first_time_species: row.first_time_species == null ? null : Boolean(row.first_time_species),
    changes_requested_on: row.changes_requested_on,
  };
}

const SELECT_ROWS = `SELECT submissions.*, members.display_name AS member_name
  FROM submissions LEFT JOIN members ON members.id = submissions.member_id`;

async function findRow(submissionId: number): Promise<Row | undefined> {
  const [row] = await query<Row>(`${SELECT_ROWS} WHERE submissions.id = ?`, [submissionId]);
  return row;
}

// ---------------------------------------------------------------------------
// Finding Submissions
// ---------------------------------------------------------------------------

const listQuery = z
  .object({
    unbound: flag.optional(),
    state: z.enum(states).optional(),
    member_id: id.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: count.default(0),
  })
  .strict();

/**
 * Submissions newest first. The state is derived per row (the waiting period
 * is a date comparison), so the state filter runs after the query; the
 * table holds hundreds of rows, not millions.
 */
router.get("/", async (req: AdminApiRequest, res) => {
  const q = parse(listQuery, req.query, res);
  if (!q) return;
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.unbound !== undefined) {
    where.push(q.unbound ? "submissions.species_id IS NULL" : "submissions.species_id IS NOT NULL");
  }
  if (q.member_id !== undefined) {
    where.push("submissions.member_id = ?");
    params.push(q.member_id);
  }
  if (q.state === "approved") where.push("submissions.approved_on IS NOT NULL");
  else if (q.state !== undefined) where.push("submissions.approved_on IS NULL");
  const rows = await query<Row>(
    `${SELECT_ROWS} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY submissions.id DESC`,
    params
  );
  const matching = q.state ? rows.filter((row) => lifecycle.deriveState(row) === q.state) : rows;
  res.json({
    total_count: matching.length,
    submissions: matching.slice(q.offset, q.offset + q.limit).map(summary),
  });
});

router.get("/:id", async (req: AdminApiRequest, res) => {
  const params = parse(idParams, req.params, res);
  if (!params) return;
  const row = await findRow(params.id);
  if (!row) return submissionNotFound(res, params.id);
  res.json({ submission: await detail(row) });
});

// ---------------------------------------------------------------------------
// Correcting the Species and points
// ---------------------------------------------------------------------------

const correctionBody = z
  .object({
    group_id: z.number().int().positive(),
    reason: z.string().trim().min(1, "Say why the Submission is being corrected").max(2000),
    points: z.number().int().optional(),
    article_points: z.number().int().nullable().optional(),
    cares_species: z.boolean().optional(),
    flowered: z.boolean().optional(),
    sexual_reproduction: z.boolean().optional(),
    first_time_species: z.boolean().optional(),
    notify: z.boolean().default(false),
    preview: z.boolean().default(false),
  })
  .strict();

/** The lifecycle's refusals: a bad request is 400, the wrong moment or the wrong person 409. */
function sendRefusal(res: Response, err: lifecycle.LifecycleError) {
  if (err instanceof lifecycle.ValidationError) {
    sendApiError(res, 400, "bad_request", err.message);
  } else {
    sendApiError(res, 409, "conflict", err.message);
  }
}

/**
 * Settle the Submission on `group_id` and correct its points, with one
 * changelog entry naming the token's admin. A points field left out keeps the
 * row's value, so binding sends only `group_id` and `reason`. The member is
 * written to only with `notify: true`; `preview: true` writes nothing.
 */
router.post("/:id/correction", async (req: AdminApiRequest, res) => {
  const params = parse(idParams, req.params, res);
  if (!params) return;
  const body = parse(correctionBody, req.body, res);
  if (!body) return;
  const row = await findRow(params.id);
  if (!row) return submissionNotFound(res, params.id);
  if (body.points === undefined && row.points == null) {
    sendApiError(res, 400, "bad_request", "points: the Submission has none yet, so send them");
    return;
  }

  const correction: lifecycle.PointsCorrection = {
    species_id: body.group_id,
    points: body.points ?? row.points ?? 0,
    article_points: body.article_points !== undefined ? body.article_points : row.article_points || null,
    cares_species: body.cares_species ?? Boolean(row.cares_species),
    flowered: body.flowered ?? Boolean(row.flowered),
    sexual_reproduction: body.sexual_reproduction ?? Boolean(row.sexual_reproduction),
    first_time_species: body.first_time_species,
  };
  // adminApiAuth re-checks on every request that the token's member is an admin
  const caller: lifecycle.Caller = { id: adminApiActor(req).member.id, isAdmin: true };

  try {
    if (body.preview) {
      const { changes, after } = await lifecycle.previewCorrection(
        caller,
        params.id,
        correction,
        body.reason
      );
      res.json({
        preview: true,
        submission_id: params.id,
        changes,
        notified: false,
        submission: await detail({ ...after, member_name: row.member_name }),
      });
      return;
    }
    const changes = await lifecycle.correctPoints(caller, params.id, correction, body.reason, {
      notify: body.notify,
    });
    const after = await findRow(params.id);
    res.json({
      preview: false,
      submission_id: params.id,
      changes,
      notified: body.notify,
      submission: after ? await detail(after) : null,
    });
  } catch (err) {
    if (!lifecycle.isLifecycleError(err)) throw err;
    sendRefusal(res, err);
  }
});

export default router;
