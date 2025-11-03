import { Response } from "express";
import { MulmRequest } from "@/sessions";

export const view = (req: MulmRequest, res: Response) => {
	res.render("hoverCardDemo", {
		title: "HoverCard Component Demo",
		bugReportEmail: "baptest@porcnick.com",
	});
};
