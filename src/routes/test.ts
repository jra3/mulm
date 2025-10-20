import { Router, Response } from "express";
import { MulmRequest } from "@/sessions";

const router = Router();

/**
 * Tom Select Demo Page
 * Isolated testing environment for all Tom Select variants
 * Only available in development/test environments
 */
router.get("/tom-select-demo", (req: MulmRequest, res: Response) => {
	const { viewer } = req;

	res.render("test/tom-select-demo", {
		title: "Tom Select Component Testing",
		viewer,
	});
});

/**
 * Handle form submission from Tom Select demo
 * Returns the posted values for verification
 */
router.post("/tom-select-demo", (req: MulmRequest, res: Response) => {
	res.json({
		success: true,
		values: req.body as Record<string, unknown>,
	});
});

export default router;
