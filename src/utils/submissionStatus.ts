import { Submission } from "../db/submissions";
import { getWaitingPeriodStatus } from "./waitingPeriod";

export type SubmissionStatus =
  | "draft"
  | "pending-witness"
  | "waiting-period"
  | "pending-approval"
  | "approved"
  | "denied";

export interface StatusInfo {
  status: SubmissionStatus;
  label: string;
  color: string;
  bgColor: string;
  rowColor: string;
  description?: string;
  daysRemaining?: number;
}

/**
 * Calculate the current status of a submission
 */
export function getSubmissionStatus(submission: Partial<Submission>): StatusInfo {
  // Denied submissions
  if (submission.denied_on) {
    return {
      status: "denied",
      label: "Denied",
      color: "text-red-800",
      bgColor: "bg-red-100",
      rowColor: "bg-red-50",
      description: submission.denied_reason || "Submission was denied",
    };
  }

  // Approved submissions
  if (submission.approved_on) {
    return {
      status: "approved",
      label: "Approved",
      color: "text-green-800",
      bgColor: "bg-green-100",
      rowColor: "bg-green-50",
      description: `${submission.points || 0} points awarded`,
    };
  }

  // Draft submissions (not yet submitted)
  if (!submission.submitted_on) {
    return {
      status: "draft",
      label: "Draft",
      color: "text-yellow-800",
      bgColor: "bg-yellow-100",
      rowColor: "bg-yellow-50",
      description: "Not yet submitted for review",
    };
  }

  // Submissions needing admin screening
  if (submission.witness_verification_status === "pending") {
    return {
      status: "pending-witness",
      label: "Pending Screening",
      color: "text-purple-800",
      bgColor: "bg-purple-100",
      rowColor: "bg-purple-50",
      description: "Awaiting admin screening",
    };
  }

  // Screened submissions awaiting auction
  if (submission.witness_verification_status === "confirmed" && submission.witnessed_on) {
    const waitingPeriodStatus = getWaitingPeriodStatus(submission as Submission);

    if (!waitingPeriodStatus.eligible) {
      return {
        status: "waiting-period",
        label: "Awaiting Auction",
        color: "text-orange-800",
        bgColor: "bg-orange-100",
        rowColor: "bg-orange-50",
        description: `${waitingPeriodStatus.daysRemaining} days until auction eligible`,
        daysRemaining: waitingPeriodStatus.daysRemaining,
      };
    }
  }

  // Submissions ready for approval
  return {
    status: "pending-approval",
    label: "Pending Review",
    color: "text-blue-800",
    bgColor: "bg-blue-100",
    rowColor: "bg-blue-50",
    description: "Ready for admin approval",
  };
}

/**
 * Get a short status badge HTML for use in tables
 */
export function getStatusBadge(submission: Partial<Submission>): string {
  const statusInfo = getSubmissionStatus(submission);
  const icon = getStatusIcon(statusInfo.status);

  return `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusInfo.bgColor} ${statusInfo.color}">
    ${icon} ${statusInfo.label}
  </span>`;
}

/**
 * Get icon for status
 */
function getStatusIcon(status: SubmissionStatus): string {
  switch (status) {
    case "draft":
      return "📝";
    case "pending-witness":
      return "👁️";
    case "waiting-period":
      return "⏳";
    case "pending-approval":
      return "🔵";
    case "approved":
      return "✅";
    case "denied":
      return "❌";
    default:
      return "";
  }
}
