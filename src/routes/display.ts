import { Router, Response } from "express";
import { MulmRequest } from "@/sessions";
import {
  getLast30DaysApprovedSubmissions,
  getLast48HoursApprovedSubmissions,
  getSubmissionImagesForMultiple,
  type Submission,
} from "@/db/submissions";
import { getLiveCTAMessage } from "@/db/settings";
import { marked } from "marked";

const router = Router();

interface CTASlide {
  type: "cta";
  message: string;
  renderedMessage: string;
}

interface NoSubmissionsSlide {
  type: "empty";
}

/**
 * Helper to attach images to submissions (optimized to avoid N+1 queries)
 */
async function attachImages<T extends Submission>(submissions: T[]): Promise<T[]> {
  if (submissions.length === 0) {
    return submissions;
  }

  // Fetch all images in one query
  const submissionIds = submissions.map((sub) => sub.id);
  const imagesBySubmission = await getSubmissionImagesForMultiple(submissionIds);

  // Attach images to each submission
  return submissions.map((sub) => ({
    ...sub,
    images: imagesBySubmission.get(sub.id) || [],
  }));
}

/**
 * Inject CTA slides into submissions array every 5-6 submissions
 * When there are no submissions, returns alternating CTA and "no submissions" slides
 */
async function injectCTASlides(
  submissions: Submission[]
): Promise<Array<Submission | CTASlide | NoSubmissionsSlide>> {
  const ctaMessage = await getLiveCTAMessage();

  // Special case: no submissions
  if (submissions.length === 0) {
    if (!ctaMessage) {
      // No CTA and no submissions - just show empty state
      return [{ type: "empty" }];
    }

    // CTA configured but no submissions - alternate between CTA and empty state
    const renderedMessage = await marked(ctaMessage);
    return [
      {
        type: "cta",
        message: ctaMessage,
        renderedMessage,
      },
      { type: "empty" },
    ];
  }

  // If no CTA message configured, return submissions as-is
  if (!ctaMessage) {
    return submissions;
  }

  const renderedMessage = await marked(ctaMessage);
  const result: Array<Submission | CTASlide> = [];
  const CTA_INTERVAL = 5; // Insert CTA every 5 submissions

  for (let i = 0; i < submissions.length; i++) {
    result.push(submissions[i]);

    // Insert CTA after every 5th submission (but not after the last submission)
    if ((i + 1) % CTA_INTERVAL === 0 && i < submissions.length - 1) {
      result.push({
        type: "cta",
        message: ctaMessage,
        renderedMessage,
      });
    }
  }

  return result;
}

/**
 * Main display page - full HTML view for large screens
 * Shows submissions approved in the last 48 hours with auto-refresh
 * No authentication required (public display)
 */
router.get("/live", async (_req: MulmRequest, res: Response) => {
  const submissions = await attachImages(await getLast48HoursApprovedSubmissions());
  const slides = await injectCTASlides(submissions);

  res.render("display", {
    submissions: slides,
    viewer: null, // No authentication required
    feedUrl: "/live/feed", // HTMX endpoint for auto-refresh
  });
});

/**
 * HTMX partial endpoint - returns just the submissions feed
 * Used for auto-refresh polling
 */
router.get("/live/feed", async (_req: MulmRequest, res: Response) => {
  const submissions = await attachImages(await getLast48HoursApprovedSubmissions());
  const slides = await injectCTASlides(submissions);

  res.render("partials/display-feed", {
    submissions: slides,
    layout: false, // Important: no layout for HTMX partials
  });
});

/**
 * Demo display page - shows last 30 days of approved submissions
 * No authentication required (public display)
 */
router.get("/live/demo", async (_req: MulmRequest, res: Response) => {
  const submissions = await attachImages(await getLast30DaysApprovedSubmissions());
  const slides = await injectCTASlides(submissions);

  res.render("display", {
    submissions: slides,
    viewer: null, // No authentication required
    feedUrl: "/live/demo/feed", // HTMX endpoint for demo auto-refresh
  });
});

/**
 * HTMX partial endpoint for demo page - returns submissions from last 30 days
 * Used for auto-refresh polling on demo page
 */
router.get("/live/demo/feed", async (_req: MulmRequest, res: Response) => {
  const submissions = await attachImages(await getLast30DaysApprovedSubmissions());
  const slides = await injectCTASlides(submissions);

  res.render("partials/display-feed", {
    submissions: slides,
    layout: false, // Important: no layout for HTMX partials
  });
});

export default router;
