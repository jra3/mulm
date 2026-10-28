/**
 * /api/admin/members (#595): member administration as REST. An admin may not
 * demote, delete or merge away the member their own token acts as (409).
 * See docs/ADMIN_API.md#members.
 */
import express, { type Response } from "express";
import { z } from "zod";
import { memberSchema } from "../../../forms/member";
import {
  adminApiActor,
  sendApiError,
  type AdminApiRequest,
} from "../../../middleware/adminApiAuth";
import {
  EmailTakenError,
  MemberHasApprovedSubmissionsError,
  deleteMember,
  getMemberDetail,
  listMembers,
  setAdminStatus,
  updateMemberDetails,
} from "../../../members/admin";
import { mergeMembers } from "../../../members/merge";
import { getMember } from "../../../db/members";

const router = express.Router();

const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

const listQuerySchema = z
  .object({
    query: z.string().optional(),
    is_admin: queryBoolean.optional(),
    has_submissions: queryBoolean.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();

const memberIdSchema = z.coerce.number().int().positive();

const updateBodySchema = z
  .object({
    display_name: z.string().trim().pipe(memberSchema.shape.display_name).optional(),
    contact_email: z.string().trim().pipe(memberSchema.shape.contact_email).optional(),
  })
  .strict()
  .refine((body) => body.display_name !== undefined || body.contact_email !== undefined, {
    message: "Send display_name, contact_email or both",
  });

const adminBodySchema = z.object({ is_admin: z.boolean() }).strict();

const mergeBodySchema = z
  .object({
    into_member_id: z.number().int().positive(),
    preview: z.boolean().default(false),
  })
  .strict();

const deleteQuerySchema = z.object({ force: queryBoolean.default(false) }).strict();

function sendInvalid(res: Response, error: z.ZodError) {
  sendApiError(
    res,
    400,
    "bad_request",
    error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ")
  );
}

/** The :id route parameter, or undefined after answering 400. */
function memberIdParam(req: AdminApiRequest, res: Response): number | undefined {
  const parsed = memberIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    sendApiError(res, 400, "bad_request", "Member id must be a positive integer");
    return undefined;
  }
  return parsed.data;
}

function sendMemberNotFound(res: Response, id: number) {
  sendApiError(res, 404, "not_found", `No member ${id}`);
}

/** Refuse, with 409, an action on the member the request's own token acts as. */
function refuseSelf(req: AdminApiRequest, res: Response, id: number, action: string): boolean {
  if (adminApiActor(req).member.id !== id) return false;
  sendApiError(res, 409, "conflict", `You cannot ${action} the member your token acts as`);
  return true;
}

router.get("/", async (req: AdminApiRequest, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendInvalid(res, parsed.error);
  const members = await listMembers(parsed.data);
  res.json({ count: members.length, members });
});

router.get("/:id", async (req: AdminApiRequest, res) => {
  const id = memberIdParam(req, res);
  if (id === undefined) return;
  const member = await getMemberDetail(id);
  if (!member) return sendMemberNotFound(res, id);
  res.json({ member });
});

router.patch("/:id", async (req: AdminApiRequest, res) => {
  const id = memberIdParam(req, res);
  if (id === undefined) return;
  const parsed = updateBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalid(res, parsed.error);
  try {
    const member = await updateMemberDetails(id, parsed.data);
    if (!member) return sendMemberNotFound(res, id);
    res.json({ member });
  } catch (error) {
    if (error instanceof EmailTakenError) {
      return sendApiError(res, 409, "conflict", error.message);
    }
    throw error;
  }
});

router.put("/:id/admin", async (req: AdminApiRequest, res) => {
  const id = memberIdParam(req, res);
  if (id === undefined) return;
  const parsed = adminBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalid(res, parsed.error);
  if (!parsed.data.is_admin && refuseSelf(req, res, id, "revoke admin from")) return;
  const member = await setAdminStatus(id, parsed.data.is_admin);
  if (!member) return sendMemberNotFound(res, id);
  res.json({ member });
});

router.delete("/:id", async (req: AdminApiRequest, res) => {
  const id = memberIdParam(req, res);
  if (id === undefined) return;
  const parsed = deleteQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendInvalid(res, parsed.error);
  if (refuseSelf(req, res, id, "delete")) return;
  try {
    const deleted = await deleteMember(id, parsed.data);
    if (!deleted) return sendMemberNotFound(res, id);
    res.json({ deleted });
  } catch (error) {
    if (error instanceof MemberHasApprovedSubmissionsError) {
      return sendApiError(res, 409, "conflict", error.message);
    }
    throw error;
  }
});

/** Merge member :id into `into_member_id`: :id's records move over and :id is deleted. */
router.post("/:id/merge", async (req: AdminApiRequest, res) => {
  const id = memberIdParam(req, res);
  if (id === undefined) return;
  const parsed = mergeBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalid(res, parsed.error);
  const { into_member_id, preview } = parsed.data;
  if (into_member_id === id) {
    return sendApiError(res, 400, "bad_request", "Cannot merge a member into itself");
  }
  if (!(await getMember(id))) return sendMemberNotFound(res, id);
  if (!(await getMember(into_member_id))) return sendMemberNotFound(res, into_member_id);
  if (refuseSelf(req, res, id, "merge away")) return;
  const result = await mergeMembers({ from_member_id: id, to_member_id: into_member_id, preview });
  res.json(result);
});

export default router;
