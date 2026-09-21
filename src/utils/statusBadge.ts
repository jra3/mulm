import { deriveState, hasChangesRequested, waitingPeriod, StateRow, SubmissionState } from "@/lifecycle";

/** What the badge needs: enough of a row to derive its state, plus its Points. */
export type BadgeRow = StateRow & { points?: number | null };

/**
 * How a Submission's state is shown: its label, its colours and its icon.
 *
 * Presentation only. The state itself is derived by the lifecycle module, so a
 * badge cannot disagree with a queue or a guard about where a Submission is -
 * this file only decides what that state looks like.
 *
 * Changes requested is an overlay rather than a state, and it is what the
 * member most needs to see, so it wins the badge when it is set.
 */
export interface StatusInfo {
  /** The lifecycle state, or the changes-requested overlay laid over it. */
  status: SubmissionState | "changesRequested";
  label: string;
  icon: string;
  color: string;
  bgColor: string;
  rowColor: string;
  description?: string;
  daysRemaining?: number;
}

const CHANGES_REQUESTED: StatusInfo = {
  status: "changesRequested",
  label: "Changes Requested",
  icon: "📝",
  color: "text-orange-800",
  bgColor: "bg-orange-100",
  rowColor: "bg-orange-50",
  description: "The committee asked for changes - edit and resubmit",
};

export function getStatusPresentation(row: BadgeRow): StatusInfo {
  const state = deriveState(row);

  // An Approved Submission cannot carry outstanding changes, so the overlay
  // only ever hides an in-flight state.
  if (state !== "approved" && hasChangesRequested(row)) {
    return CHANGES_REQUESTED;
  }

  switch (state) {
    case "draft":
      return {
        status: state,
        label: "Draft",
        icon: "📝",
        color: "text-yellow-800",
        bgColor: "bg-yellow-100",
        rowColor: "bg-yellow-50",
        description: "Not yet submitted for review",
      };

    case "pendingWitness":
      return {
        status: state,
        label: "Pending Screening",
        icon: "👁️",
        color: "text-purple-800",
        bgColor: "bg-purple-100",
        rowColor: "bg-purple-50",
        description: "Awaiting committee screening",
      };

    case "waitingPeriod": {
      const { daysRemaining } = waitingPeriod(row);
      return {
        status: state,
        label: "Awaiting Auction",
        icon: "⏳",
        color: "text-orange-800",
        bgColor: "bg-orange-100",
        rowColor: "bg-orange-50",
        description: `${daysRemaining} days until auction eligible`,
        daysRemaining,
      };
    }

    case "awaitingFinalSubmission":
      return {
        status: state,
        label: "Bring to Meeting",
        icon: "🐟",
        color: "text-teal-800",
        bgColor: "bg-teal-100",
        rowColor: "bg-teal-50",
        description: "Bring to a monthly meeting and confirm to enter the approval queue",
      };

    case "inApprovalQueue":
      return {
        status: state,
        label: "Pending Review",
        icon: "🔵",
        color: "text-blue-800",
        bgColor: "bg-blue-100",
        rowColor: "bg-blue-50",
        description: "Ready for committee approval",
      };

    case "approved":
      return {
        status: state,
        label: "Approved",
        icon: "✅",
        color: "text-green-800",
        bgColor: "bg-green-100",
        rowColor: "bg-green-50",
        description: `${row.points || 0} points awarded`,
      };
  }
}
