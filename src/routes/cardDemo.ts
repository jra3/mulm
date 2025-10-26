import { Response } from "express";
import { MulmRequest } from "@/sessions";

export const view = (req: MulmRequest, res: Response) => {
	res.render("cardDemo", {
		title: "Card Mixin Demo - Issue #136",
	});
};
