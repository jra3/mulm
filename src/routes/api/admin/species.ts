/**
 * Species endpoints of the admin API (#595), mounted at /api/admin/species.
 * They expose the catalogue, enrichment and IUCN operations; see the Species section of docs/ADMIN_API.md.
 */
import express, { type NextFunction, type Response } from "express";
import { z } from "zod";
import * as catalogue from "@/species";
import { canonicalName, CatalogueRefusal, type SpeciesAdminFilters } from "@/species";
import {
  getSpeciesExternalReferences,
  getSpeciesImages,
  setSpeciesExternalReferences,
  setSpeciesImages,
} from "@/db/speciesEnrichment";
import {
  acceptCanonicalRecommendation,
  getCanonicalRecommendations,
  getIucnSyncLog,
  getIucnSyncStats,
  getSpeciesNeedingResync,
  getSpeciesWithMissingIucn,
  RecommendationNotFound,
  rejectCanonicalRecommendation,
  syncSpeciesIucn,
} from "@/db/iucn";
import { db } from "@/db/conn";
import { getIUCNClient, type IUCNClient } from "@/integrations/iucn";
import { refusalStatus } from "@/routes/admin/species";
import { adminApiActor, sendApiError, type AdminApiRequest } from "@/middleware/adminApiAuth";

const router = express.Router();

/** More than the catalogue holds: a page size that means "every Species". */
const ALL_SPECIES = 100000;

const id = z.coerce.number().int().positive();
const count = z.coerce.number().int().nonnegative();
/** A query-string boolean: only `true` or `false`. */
const flag = z.enum(["true", "false"]).transform((v) => v === "true");
const nameKind = z.enum(["common", "scientific"]);
const pointClass = z.literal(catalogue.pointClasses);

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

function speciesNotFound(res: Response, speciesId: number) {
  sendApiError(res, 404, "not_found", `Species ${speciesId} not found`);
}

/** The Species with its Names, references and images, or a 404 already sent. */
async function sendDetail(res: Response, speciesId: number, status = 200) {
  const detail = await catalogue.getSpeciesDetail(speciesId);
  if (!detail) return speciesNotFound(res, speciesId);
  res.status(status).json(detail);
}

/** Every Name of the given text, across all Species, with the Canonical name of the Species it names. */
async function findNamesByText(text: string, kind?: catalogue.NameKind) {
  const names = await catalogue.findNames(text, kind);
  const species = new Map(
    (await catalogue.findSpeciesByIds([...new Set(names.map((n) => n.species_id))])).map((sp) => [
      sp.group_id,
      sp,
    ])
  );
  return names.map((name) => {
    const sp = species.get(name.species_id);
    return {
      ...name,
      canonical_name: sp ? canonicalName(sp) : null,
      program_class: sp?.program_class ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Searching and creating Species
// ---------------------------------------------------------------------------

const searchQuery = z.object({
  q: z.string().optional(),
  species_type: z.enum(catalogue.speciesTypes).optional(),
  program_class: z.string().optional(),
  has_base_points: flag.optional(),
  is_cares_species: flag.optional(),
  iucn_category: z.string().optional(),
  sort: z.enum(["name", "points", "class"]).default("name"),
  limit: count.default(100),
  offset: count.default(0),
  count_only: flag.default(false),
});

router.get("/", async (req: AdminApiRequest, res) => {
  const query = parse(searchQuery, req.query, res);
  if (!query) return;
  const filters: SpeciesAdminFilters = {
    species_type: query.species_type,
    program_class: query.program_class,
    has_base_points: query.has_base_points,
    is_cares_species: query.is_cares_species,
    iucn_category: query.iucn_category,
    search: query.q,
  };
  const result = await catalogue.getSpeciesForAdmin(filters, query.sort, query.limit, query.offset);
  if (query.count_only) {
    res.json({ total_count: result.total_count });
    return;
  }
  res.json({
    total_count: result.total_count,
    species: result.species.map((s) => ({
      group_id: s.group_id,
      program_class: s.program_class,
      canonical_genus: s.canonical_genus,
      canonical_species_name: s.canonical_species_name,
      species_type: s.species_type,
      base_points: s.base_points,
      is_cares_species: Boolean(s.is_cares_species),
      name_count: s.name_count,
    })),
  });
});

const createBody = z.object({
  program_class: z.string(),
  canonical_genus: z.string(),
  canonical_species_name: z.string(),
  species_type: z.enum(catalogue.speciesTypes),
  base_points: pointClass.nullable().optional(),
  is_cares_species: z.boolean().optional(),
});

router.post("/", async (req: AdminApiRequest, res) => {
  const body = parse(createBody, req.body, res);
  if (!body) return;
  const speciesId = await catalogue.createSpecies({
    programClass: body.program_class,
    speciesType: body.species_type,
    canonicalGenus: body.canonical_genus,
    canonicalSpeciesName: body.canonical_species_name,
    pointClass: body.base_points,
    isCaresSpecies: body.is_cares_species,
  });
  res.location(`${req.baseUrl}/${speciesId}`);
  await sendDetail(res, speciesId, 201);
});

const pointClassBody = z
  .object({
    group_ids: z.array(id).min(1).optional(),
    species_type: z.string().min(1).optional(),
    program_class: z.string().min(1).optional(),
    base_points: pointClass,
    preview: z.boolean().default(false),
  })
  .refine(
    (b) =>
      (b.group_ids !== undefined) !==
      (b.species_type !== undefined || b.program_class !== undefined),
    "Give either group_ids or species_type/program_class filters"
  );

router.post("/point-class", async (req: AdminApiRequest, res) => {
  const body = parse(pointClassBody, req.body, res);
  if (!body) return;
  const targetIds =
    body.group_ids ??
    (
      await catalogue.getSpeciesForAdmin(
        { species_type: body.species_type, program_class: body.program_class },
        "name",
        ALL_SPECIES,
        0
      )
    ).species.map((s) => s.group_id);
  const affected = await catalogue.findSpeciesByIds(targetIds);
  const updated_count =
    body.preview || affected.length === 0
      ? affected.length
      : await catalogue.setPointClass(
          affected.map((s) => s.group_id),
          body.base_points
        );
  res.json({
    preview: body.preview,
    updated_count,
    species: affected.map((s) => ({
      group_id: s.group_id,
      canonical_name: canonicalName(s),
      old_points: s.base_points,
      new_points: body.base_points,
    })),
  });
});

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const findNamesQuery = z.object({
  text: z.string().min(1),
  kind: nameKind.optional(),
  limit: count.optional(),
});

router.get("/names", async (req: AdminApiRequest, res) => {
  const query = parse(findNamesQuery, req.query, res);
  if (!query) return;
  const found = await findNamesByText(query.text, query.kind);
  const names = query.limit ? found.slice(0, query.limit) : found;
  res.json({ text: query.text, count: names.length, names });
});

const bulkRemoveBody = z
  .object({
    kind: nameKind,
    text: z.string().min(1).optional(),
    name_ids: z.array(id).min(1).optional(),
    preview: z.boolean().default(false),
  })
  .refine(
    (b) => (b.text === undefined) !== (b.name_ids === undefined),
    "Give exactly one of text or name_ids"
  );

router.post("/names/bulk-remove", async (req: AdminApiRequest, res) => {
  const body = parse(bulkRemoveBody, req.body, res);
  if (!body) return;
  const matched = body.text !== undefined ? await findNamesByText(body.text, body.kind) : undefined;
  const ids = matched ? matched.map((n) => n.name_id) : (body.name_ids ?? []);
  if (body.preview) {
    res.json({
      preview: true,
      kind: body.kind,
      count: ids.length,
      ...(matched ? { names: matched } : { name_ids: ids }),
    });
    return;
  }
  const removed = await catalogue.removeName(body.kind, ids);
  res.json({ preview: false, kind: body.kind, count: removed });
});

const nameParams = z.object({ kind: nameKind, nameId: id });

router.patch("/names/:kind/:nameId", async (req: AdminApiRequest, res) => {
  const params = parse(nameParams, req.params, res);
  if (!params) return;
  const body = parse(z.object({ name: z.string() }), req.body, res);
  if (!body) return;
  const changes = await catalogue.updateName(params.kind, params.nameId, body.name);
  if (changes === 0) {
    sendApiError(res, 404, "not_found", `No ${params.kind} name ${params.nameId}`);
    return;
  }
  res.json({ kind: params.kind, name_id: params.nameId, name: body.name.trim() });
});

router.delete("/names/:kind/:nameId", async (req: AdminApiRequest, res) => {
  const params = parse(nameParams, req.params, res);
  if (!params) return;
  const changes = await catalogue.removeName(params.kind, params.nameId);
  if (changes === 0) {
    sendApiError(res, 404, "not_found", `No ${params.kind} name ${params.nameId}`);
    return;
  }
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// IUCN Red List status
// ---------------------------------------------------------------------------

router.get("/iucn/stats", async (_req: AdminApiRequest, res) => {
  res.json(await getIucnSyncStats(db()));
});

router.get("/iucn/missing", async (_req: AdminApiRequest, res) => {
  const species = await getSpeciesWithMissingIucn(db());
  res.json({ total_count: species.length, species });
});

router.get("/iucn/stale", async (req: AdminApiRequest, res) => {
  const query = parse(z.object({ days_old: count.default(365) }), req.query, res);
  if (!query) return;
  const species = await getSpeciesNeedingResync(db(), query.days_old);
  res.json({ total_count: species.length, days_old: query.days_old, species });
});

router.get("/iucn/sync-log", async (req: AdminApiRequest, res) => {
  const query = parse(
    z.object({ group_id: id.optional(), limit: count.default(100) }),
    req.query,
    res
  );
  if (!query) return;
  const entries = await getIucnSyncLog(db(), query.group_id, query.limit);
  res.json({ total_count: entries.length, entries });
});

const iucnSyncBody = z
  .object({
    group_ids: z.array(id).min(1).optional(),
    missing: z.literal(true).optional(),
    days_old: count.optional(),
    limit: count.default(10),
    preview: z.boolean().default(false),
  })
  .refine(
    (b) => [b.group_ids, b.missing, b.days_old].filter((v) => v !== undefined).length === 1,
    "Give exactly one of group_ids, missing: true or days_old"
  );

router.post("/iucn/sync", async (req: AdminApiRequest, res) => {
  const body = parse(iucnSyncBody, req.body, res);
  if (!body) return;
  const database = db(true);
  let targets: { group_id: number; canonical_genus: string; canonical_species_name: string }[];
  if (body.group_ids) {
    targets = await catalogue.findSpeciesByIds(body.group_ids);
    const missing = body.group_ids.filter((g) => !targets.some((t) => t.group_id === g));
    if (missing.length > 0) {
      sendApiError(res, 404, "not_found", `Species ${missing.join(", ")} not found`);
      return;
    }
  } else if (body.missing) {
    targets = await getSpeciesWithMissingIucn(database);
  } else {
    targets = await getSpeciesNeedingResync(database, body.days_old ?? 0);
  }
  targets = targets.slice(0, body.limit);

  const species = targets.map((s) => ({ group_id: s.group_id, canonical_name: canonicalName(s) }));
  if (body.preview || targets.length === 0) {
    res.json({ preview: body.preview, total_count: targets.length, species });
    return;
  }

  let client: IUCNClient;
  try {
    client = getIUCNClient();
  } catch (err) {
    sendApiError(
      res,
      503,
      "unavailable",
      err instanceof Error ? err.message : "IUCN sync unavailable"
    );
    return;
  }
  const results = [];
  for (const target of targets) results.push(await syncSpeciesIucn(database, client, target));
  res.json({
    preview: false,
    total_count: results.length,
    success_count: results.filter((r) => r.status === "success").length,
    not_found_count: results.filter((r) => r.status === "not_found").length,
    error_count: results.filter((r) => r.status === "api_error").length,
    results,
  });
});

// ---------------------------------------------------------------------------
// Canonical name recommendations (from IUCN)
// ---------------------------------------------------------------------------

router.get("/canonical-recommendations", async (req: AdminApiRequest, res) => {
  const query = parse(
    z.object({
      group_id: id.optional(),
      status: z.enum(["pending", "accepted", "rejected"]).optional(),
      limit: count.optional(),
    }),
    req.query,
    res
  );
  if (!query) return;
  const recommendations = await getCanonicalRecommendations(db(), {
    groupId: query.group_id,
    status: query.status,
    limit: query.limit,
  });
  res.json({
    total_count: recommendations.length,
    recommendations: recommendations.map((rec) => ({
      id: rec.id,
      group_id: rec.group_id,
      current_name: `${rec.current_canonical_genus} ${rec.current_canonical_species}`,
      suggested_name: `${rec.suggested_canonical_genus} ${rec.suggested_canonical_species}`,
      iucn_taxon_id: rec.iucn_taxon_id,
      iucn_url: rec.iucn_url,
      reason: rec.reason,
      status: rec.status,
      created_at: rec.created_at,
      reviewed_at: rec.reviewed_at,
      reviewed_by: rec.reviewed_by,
    })),
  });
});

const reviews = {
  accept: { review: acceptCanonicalRecommendation, status: "accepted" },
  reject: { review: rejectCanonicalRecommendation, status: "rejected" },
} as const;

router.post("/canonical-recommendations/:id/:verdict", async (req: AdminApiRequest, res) => {
  const params = parse(z.object({ id, verdict: z.enum(["accept", "reject"]) }), req.params, res);
  if (!params) return;
  const { member } = adminApiActor(req);
  const { review, status } = reviews[params.verdict];
  await review(db(true), params.id, member.id);
  res.json({ recommendation_id: params.id, status, reviewed_by: member.id });
});

// ---------------------------------------------------------------------------
// One Species
// ---------------------------------------------------------------------------

router.get("/:id", async (req: AdminApiRequest, res) => {
  const params = parse(idParams, req.params, res);
  if (!params) return;
  await sendDetail(res, params.id);
});

const updateBody = z
  .object({
    program_class: z.string().optional(),
    base_points: pointClass.nullable().optional(),
    is_cares_species: z.boolean().optional(),
  })
  .refine(
    (b) => Object.values(b).some((v) => v !== undefined),
    "Give at least one of program_class, base_points or is_cares_species"
  );

router.patch("/:id", async (req: AdminApiRequest, res) => {
  const params = parse(idParams, req.params, res);
  if (!params) return;
  const body = parse(updateBody, req.body, res);
  if (!body) return;
  if (!(await catalogue.findSpeciesById(params.id))) return speciesNotFound(res, params.id);
  await catalogue.updateSpecies(params.id, {
    programClass: body.program_class,
    pointClass: body.base_points,
    isCaresSpecies: body.is_cares_species,
  });
  await sendDetail(res, params.id);
});

router.delete("/:id", async (req: AdminApiRequest, res) => {
  const params = parse(idParams, req.params, res);
  if (!params) return;
  await catalogue.deleteSpecies(params.id);
  res.status(204).end();
});

router.post("/:id/names", async (req: AdminApiRequest, res) => {
  const params = parse(idParams, req.params, res);
  if (!params) return;
  const body = parse(z.object({ kind: nameKind, name: z.string() }), req.body, res);
  if (!body) return;
  const nameId = await catalogue.addName(params.id, body.kind, body.name);
  res
    .status(201)
    .json({ kind: body.kind, name_id: nameId, group_id: params.id, name: body.name.trim() });
});

const canonicalNameBody = z
  .object({
    canonical_genus: z.string().min(1).optional(),
    canonical_species_name: z.string().min(1).optional(),
  })
  .refine(
    (b) => b.canonical_genus !== undefined || b.canonical_species_name !== undefined,
    "Give canonical_genus, canonical_species_name or both"
  );

/** The same rename as the admin edit form: the old Canonical name is kept as a scientific Name. */
router.patch("/:id/canonical-name", async (req: AdminApiRequest, res) => {
  const params = parse(idParams, req.params, res);
  if (!params) return;
  const body = parse(canonicalNameBody, req.body, res);
  if (!body) return;
  const species = await catalogue.findSpeciesById(params.id);
  if (!species) return speciesNotFound(res, params.id);
  await catalogue.renameCanonical(
    params.id,
    body.canonical_genus ?? species.canonical_genus,
    body.canonical_species_name ?? species.canonical_species_name
  );
  await sendDetail(res, params.id);
});

const externalDataBody = z
  .object({
    external_references: z.array(z.string()).optional(),
    image_links: z.array(z.string()).optional(),
  })
  .refine(
    (b) => b.external_references !== undefined || b.image_links !== undefined,
    "Give external_references, image_links or both"
  );

/**
 * Each list given replaces the Species' list of that kind outright (an empty
 * list clears it); a list left out is untouched. Stamps the last external sync.
 */
router.put("/:id/external-data", async (req: AdminApiRequest, res) => {
  const params = parse(idParams, req.params, res);
  if (!params) return;
  const body = parse(externalDataBody, req.body, res);
  if (!body) return;
  if (!(await catalogue.findSpeciesById(params.id))) return speciesNotFound(res, params.id);
  if (body.external_references !== undefined) {
    await setSpeciesExternalReferences(params.id, body.external_references);
  }
  if (body.image_links !== undefined) {
    await setSpeciesImages(params.id, body.image_links);
  }
  const syncedAt = new Date();
  await catalogue.updateLastExternalSync(params.id, syncedAt);
  const [references, images] = await Promise.all([
    getSpeciesExternalReferences(params.id),
    getSpeciesImages(params.id),
  ]);
  res.json({
    group_id: params.id,
    external_references: references.map((r) => r.reference_url),
    image_links: images.map((i) => i.image_url),
    last_external_sync: syncedAt.toISOString(),
  });
});

const mergeBody = z.object({ defunct_group_id: id, preview: z.boolean().default(false) });

/** Merge the defunct Species into this one, which is kept. */
router.post("/:id/merge", async (req: AdminApiRequest, res) => {
  const params = parse(idParams, req.params, res);
  if (!params) return;
  const body = parse(mergeBody, req.body, res);
  if (!body) return;
  const plan = await catalogue.previewMerge(params.id, body.defunct_group_id);
  if (!body.preview) await catalogue.mergeSpecies(params.id, body.defunct_group_id);
  res.json({
    preview: body.preview,
    canonical_group_id: params.id,
    defunct_group_id: body.defunct_group_id,
    canonical_name: plan.winnerCanonicalName,
    defunct_name: plan.loserCanonicalName,
    common_names_to_move: plan.moving.common,
    scientific_names_to_move: plan.moving.scientific,
    common_names_already_held: plan.folding.common,
    scientific_names_already_held: plan.folding.scientific,
    defunct_canonical_name_kept_as_scientific_name: plan.keepsLoserCanonicalName,
    submissions_to_update: plan.submissions.total,
    approved_submissions_to_update: plan.submissions.approved,
    references_to_move: {
      collection_entries: plan.references.collection,
      cares_registrations: plan.references.caresRegistrations,
      cares_articles: plan.references.caresArticles,
      cares_fry_shares: plan.references.caresFryShares,
      images: plan.references.images,
      external_references: plan.references.externalReferences,
    },
    canonical_becomes_cares: plan.winnerBecomesCares,
    // Each keeps the canonical Species' entry; the defunct one's is marked removed.
    members_keeping_both: plan.membersKeepingBoth.map((c) => ({
      member_id: c.memberId,
      display_name: c.displayName,
    })),
  });
});

/** The catalogue's refusals are 400, 404 or 409 by their code; a missing recommendation is 404. */
router.use((err: unknown, _req: AdminApiRequest, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  if (err instanceof CatalogueRefusal) {
    const status = refusalStatus[err.code];
    const error = status === 404 ? "not_found" : status === 409 ? "conflict" : "bad_request";
    sendApiError(res, status, error, err.message);
    return;
  }
  if (err instanceof RecommendationNotFound) {
    sendApiError(res, 404, "not_found", err.message);
    return;
  }
  next(err);
});

export default router;
