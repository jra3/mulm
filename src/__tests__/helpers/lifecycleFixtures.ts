import { query, writeConn } from "../../db/conn";
import type { Submission } from "../../db/submissions";
import type { MemberRecord } from "../../db/members";
import type { Caller, Notifier, PointsCorrection, SubmissionState, WitnessedFacts, WitnessPoints } from "../../lifecycle";
import { approve, previewApproval, setNotifier } from "../../lifecycle";
import { countSubmissionsOfSpecies } from "../../species";
import { createTestSubmission, ensureGuppySpecies, type CreateSubmissionOptions } from "./testHelpers";
import type { Database } from "sqlite";

/**
 * Put a Submission into a named lifecycle state.
 *
 * The clock is not a seam: Waiting period and the approval queue are
 * separated only by a date comparison, so a fixture straddles that edge by
 * writing a reproduction date in the past, the way the rest of the suite does.
 *
 * A submitted Submission is bound unless the caller says otherwise, since a
 * Witness cannot be confirmed without one: to Poecilia reticulata, which the
 * default Submission (Guppy, Fish, Livebearers) agrees with. Pass
 * `speciesId: null` for an unbound one.
 */
export async function submissionInState(
  db: Database,
  state: SubmissionState,
  options: Omit<CreateSubmissionOptions, "submitted" | "approved"> & {
    changesRequestedBy?: number;
  }
): Promise<number> {
  const longAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  const today = new Date().toISOString();

  const base: CreateSubmissionOptions = {
    ...options,
    speciesId:
      options.speciesId !== undefined ? options.speciesId : state === "draft" ? null : await ensureGuppySpecies(db),
    // Everything past the Witness gate needs a date old enough to have served
    // its waiting period, except the one state that is defined by not having.
    reproductionDate:
      options.reproductionDate ?? (state === "waitingPeriod" ? today : longAgo),
  };

  switch (state) {
    case "draft":
      return createTestSubmission(db, { ...base, submitted: false, witnessStatus: null });

    case "pendingWitness":
      return createTestSubmission(db, { ...base, submitted: true, witnessStatus: "pending" });

    case "waitingPeriod":
    case "inApprovalQueue":
      return createTestSubmission(db, { ...base, submitted: true, witnessStatus: "confirmed" });

    case "approved":
      return createTestSubmission(db, {
        ...base,
        submitted: true,
        witnessStatus: "confirmed",
        approved: true,
        approvedBy: options.witnessedBy,
      });
  }
}

/**
 * What a witness sets when confirming: base points of 10 and no bonuses,
 * against the Species the Submission is already bound to. Override what a
 * test is about.
 */
export function witnessPoints(overrides: Partial<WitnessPoints> = {}): WitnessPoints {
  return {
    points: 10,
    article_points: null,
    cares_species: false,
    flowered: false,
    sexual_reproduction: false,
    ...overrides,
  };
}

/**
 * A correction that keeps everything the row carries (#528): the base points
 * and bonuses as they stand, against the bound Species, with first-time as
 * approval decided it on an Approved row. Override what a test is about, so a
 * test that changes the base points does not also silently drop a bonus.
 */
export async function correctionOf(
  submissionId: number,
  overrides: Partial<PointsCorrection> = {}
): Promise<PointsCorrection> {
  const row = (await readSubmission(submissionId))!;
  return {
    points: row.points ?? 10,
    article_points: row.article_points || null,
    cares_species: Boolean(row.cares_species),
    flowered: Boolean(row.flowered),
    sexual_reproduction: Boolean(row.sexual_reproduction),
    ...(row.approved_on != null ? { first_time_species: Boolean(row.first_time_species) } : {}),
    ...overrides,
  };
}

/**
 * The total the approval queue would show for a Submission right now: the
 * points the Witness set plus first-time if its Species has no approved
 * Submission yet. What the approve button posts.
 */
export async function shownTotal(submissionId: number): Promise<number> {
  const row = (await readSubmission(submissionId))!;
  const approvedBefore = row.species_id == null ? 0 : (await countSubmissionsOfSpecies(row.species_id)).approved;
  return previewApproval(row, approvedBefore).total;
}

/**
 * Approve as a committee member who has just read the queue page: the total
 * posted is the one it shows. For a test about approval's other refusals;
 * a test about the stale total passes its own number to `approve`.
 */
export async function approveAsShown(caller: Caller, submissionId: number): Promise<void> {
  await approve(caller, submissionId, await shownTotal(submissionId));
}

/** Lay the Changes requested overlay over whatever state a Submission is in. */
export async function requestChangesFixture(
  submissionId: number,
  adminId: number,
  reason = "Please add a photo of the fry"
): Promise<void> {
  const stmt = await writeConn.prepare(
    `UPDATE submissions SET changes_requested_on = ?, changes_requested_by = ?,
       changes_requested_reason = ? WHERE id = ?`
  );
  try {
    await stmt.run(new Date().toISOString(), adminId, reason, submissionId);
  } finally {
    await stmt.finalize();
  }
}

/** Read a Submission back, raw. */
export async function readSubmission(submissionId: number): Promise<Submission | undefined> {
  const rows = await query<Submission>("SELECT * FROM submissions WHERE id = ?", [submissionId]);
  return rows[0];
}

/** One letter the Portal sent, as the recorder saw it. */
export type SentLetter = {
  kind: string;
  to: string[];
  about?: number | string;
};

/**
 * A notifier that records instead of sending.
 *
 * The module's own seam, and the only one its tests reach past the interface
 * for: emails are disabled whenever NODE_ENV is test, so who received which
 * letter is the one consequence a test cannot read back out of the database -
 * and who receives what is exactly what this work changes.
 */
export class RecordingNotifier implements Notifier {
  readonly sent: SentLetter[] = [];

  /** What the letters that report delivery answer. Set false to play a dead mail server. */
  deliver = true;

  /** Every letter of one kind. */
  of(kind: string): SentLetter[] {
    return this.sent.filter((letter) => letter.kind === kind);
  }

  /** Every kind of letter sent, in order. */
  get kinds(): string[] {
    return this.sent.map((letter) => letter.kind);
  }

  /** Forget everything recorded so far: the letters, the reasons and the Witness facts. */
  clear(): void {
    this.sent.length = 0;
    this.reasons.length = 0;
    this.witnessed.length = 0;
  }

  private record(kind: string, to: string | string[] | undefined, about?: number | string) {
    this.sent.push({
      kind,
      to: to === undefined ? [] : Array.isArray(to) ? to : [to],
      about,
    });
  }

  submissionReceived(submission: { id: number }, member: { contact_email: string }) {
    this.record("submissionReceived", member.contact_email, submission.id);
    return Promise.resolve();
  }
  witnessConfirmed(
    submission: Submission,
    member: { contact_email: string },
    witness: MemberRecord,
    facts: WitnessedFacts
  ) {
    this.record("witnessConfirmed", member.contact_email, submission.id);
    this.witnessed.push({ submission, witness, facts });
    return Promise.resolve();
  }
  waitingPeriodComplete(submission: { id: number }, member: { contact_email: string }) {
    this.record("waitingPeriodComplete", member.contact_email, submission.id);
    return Promise.resolve(this.deliver);
  }
  changesRequested(submission: { id: number }, member: { contact_email: string }, reason: string) {
    this.record("changesRequested", member.contact_email, submission.id);
    this.reasons.push(reason);
    return Promise.resolve();
  }
  approved(submission: { id: number }, member: { contact_email: string }) {
    this.record("approved", member.contact_email, submission.id);
    return Promise.resolve();
  }
  deletedByCommittee(submission: { id: number }, member: { contact_email: string }) {
    this.record("deletedByCommittee", member.contact_email, submission.id);
    return Promise.resolve();
  }
  levelUp(member: { contact_email: string }, program: string, newLevel: string) {
    this.record("levelUp", member.contact_email, `${program}:${newLevel}`);
    return Promise.resolve();
  }
  specialtyAward(member: { contact_email: string }, awardName: string) {
    this.record("specialtyAward", member.contact_email, awardName);
    return Promise.resolve();
  }
  committeeDigest(recipients: string[], digest: { total: number }) {
    this.record("committeeDigest", recipients, digest.total);
    return Promise.resolve();
  }
  rewitnessPending(member: { contact_email: string }, submissions: { id: number }[]) {
    this.record("rewitnessPending", member.contact_email, submissions.map((s) => s.id).join(","));
    return Promise.resolve(this.deliver);
  }

  /** The text the committee sent with a request for changes. */
  readonly reasons: string[] = [];

  /** What each Witness letter was given: the row as written, who witnessed, and the Species facts. */
  readonly witnessed: { submission: Submission; witness: MemberRecord; facts: WitnessedFacts }[] = [];
}

/** Install a recorder for the duration of a test. */
export function recordNotifications(): RecordingNotifier {
  const recorder = new RecordingNotifier();
  setNotifier(recorder);
  return recorder;
}
