import { Router, Response } from "express";
import { MulmRequest } from "@/sessions";
import { getTodayApprovedSubmissions, getLast30DaysApprovedSubmissions } from "@/db/submissions";

const router = Router();

/**
 * Main display page - full HTML view for large screens
 * Shows submissions approved today with auto-refresh
 * No authentication required (public display)
 */
router.get("/live", async (_req: MulmRequest, res: Response) => {
  const submissions = await getTodayApprovedSubmissions();

  res.render("display", {
    submissions,
    viewer: null, // No authentication required
    feedUrl: "/live/feed", // HTMX endpoint for auto-refresh
  });
});

/**
 * HTMX partial endpoint - returns just the submissions feed
 * Used for auto-refresh polling
 */
router.get("/live/feed", async (_req: MulmRequest, res: Response) => {
  const submissions = await getTodayApprovedSubmissions();

  res.render("partials/display-feed", {
    submissions,
    layout: false, // Important: no layout for HTMX partials
  });
});

/**
 * Demo display page - shows last 30 days of approved submissions
 * No authentication required (public display)
 */
router.get("/live/demo", async (_req: MulmRequest, res: Response) => {
  const submissions = await getLast30DaysApprovedSubmissions();

  res.render("display", {
    submissions,
    viewer: null, // No authentication required
    feedUrl: "/live/demo/feed", // HTMX endpoint for demo auto-refresh
  });
});

/**
 * HTMX partial endpoint for demo page - returns submissions from last 30 days
 * Used for auto-refresh polling on demo page
 */
router.get("/live/demo/feed", async (_req: MulmRequest, res: Response) => {
  const submissions = await getLast30DaysApprovedSubmissions();

  res.render("partials/display-feed", {
    submissions,
    layout: false, // Important: no layout for HTMX partials
  });
});

export default router;
