import { Router, Response } from "express";
import { MulmRequest } from "@/sessions";
import { getTodayApprovedSubmissions } from "@/db/submissions";

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

export default router;
