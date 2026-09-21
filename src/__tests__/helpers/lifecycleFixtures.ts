import { query, writeConn } from "../../db/conn";
import type { Submission } from "../../db/submissions";
import type { Notifier, SubmissionState } from "../../lifecycle";
import { setNotifier } from "../../lifecycle";
import { createTestSubmission, type CreateSubmissionOptions } from "./testHelpers";
import type { Database } from "sqlite";

/**
 * Put a Submission into a named lifecycle state.
 *
 * The clock is not a seam: Waiting period and Awaiting final submission are
 * separated only by a date comparison, so a fixture straddles that edge by
 * writing a reproduction date in the past, the way the rest of the suite does.
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
    case "awaitingFinalSubmission":
      return createTestSubmission(db, { ...base, submitted: true, witnessStatus: "confirmed" });

    case "inApprovalQueue": {
      const id = await createTestSubmission(db, {
        ...base,
        submitted: true,
        witnessStatus: "confirmed",
      });
      await setColumn(id, "final_submission_on", today);
      return id;
    }

    case "approved": {
      const id = await createTestSubmission(db, {
        ...base,
        submitted: true,
        witnessStatus: "confirmed",
        approved: true,
        approvedBy: options.witnessedBy,
      });
      await setColumn(id, "final_submission_on", today);
      return id;
    }
  }
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

async function setColumn(submissionId: number, column: string, value: unknown): Promise<void> {
  const stmt = await writeConn.prepare(`UPDATE submissions SET ${column} = ? WHERE id = ?`);
  try {
    await stmt.run(value, submissionId);
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

  /** Every letter of one kind. */
  of(kind: string): SentLetter[] {
    return this.sent.filter((letter) => letter.kind === kind);
  }

  /** Every kind of letter sent, in order. */
  get kinds(): string[] {
    return this.sent.map((letter) => letter.kind);
  }

  clear(): void {
    this.sent.length = 0;
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
  witnessConfirmed(submission: { id: number }, member: { contact_email: string }) {
    this.record("witnessConfirmed", member.contact_email, submission.id);
    return Promise.resolve();
  }
  waitingPeriodComplete(submission: { id: number }, member: { contact_email: string }) {
    this.record("waitingPeriodComplete", member.contact_email, submission.id);
    return Promise.resolve(true);
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

  /** The text the committee sent with a request for changes. */
  readonly reasons: string[] = [];
}

/** Install a recorder for the duration of a test. */
export function recordNotifications(): RecordingNotifier {
  const recorder = new RecordingNotifier();
  setNotifier(recorder);
  return recorder;
}
