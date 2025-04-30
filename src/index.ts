import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname));

import config from "@/config.json";
import express from "express";
import cookieParser from "cookie-parser";
import * as auth from "@/routes/auth";

import {
	getApprovedSubmissions,
	getApprovedSubmissionsInDateRange,
	getOutstandingSubmissions,
	getOutstandingSubmissionsCounts,
	getSubmissionsByMember,
} from "./db/submissions";
import {
	foodTypes,
	getBapFormTitle,
	getClassOptions,
	isLivestock,
	spawnLocations,
	speciesTypes,
	waterTypes,
} from "./forms/submission";

import { levelRules, minYear, programs } from "./programs";
import { MulmRequest, sessionMiddleware } from "./sessions";

import { memberSchema } from "./forms/member";
import {
	Member,
	getMembersList,
	getRoster,
	getMember,
	updateMember,
	getMemberWithAwards,
	getMemberPassword,
	createOrUpdatePassword,
} from "./db/members";
import { getGoogleOAuthURL } from "./oauth";
import {
	adminApproveSubmission,
	createSubmission,
	deleteSubmission,
	updateSubmission,
	viewSubmission,
} from "./routes/submissions";

import {
	updateSchema,
} from "./forms/login";
import { checkPassword, makePasswordEntry } from "./auth";

const app = express();

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

app.use(express.static(path.join(__dirname, "../public")));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(cookieParser());
app.use(sessionMiddleware);

const router = express.Router();

// Password Auth ///////////////////////////////////////////
router.post("/signup", auth.signup);
router.post("/login", auth.passwordLogin);
router.get("/logout", auth.logout);
router.get("/forgot-password", auth.validateForgotPassword);
router.post("/forgot-password", auth.sendForgotPassword);
router.post("/reset-password", auth.resetPassword);

router.get("/dialog/signin", async (req, res) => {
	res.render("account/signin", {
		viewer: {},
		errors: new Map(),
		googleURL: await getGoogleOAuthURL(),
	});
});

router.get("/dialog/signup", (req, res) => {
	res.render("account/signup", {
		viewer: {},
		errors: new Map(),
	});
});

router.get("/dialog/forgot-password", (req, res) => {
	res.render("account/forgotPassword", {
		errors: new Map(),
	});
});

// OAuth ///////////////////////////////////////////////////

router.get("/oauth/google", auth.googleOAuth);

// App Stuff ///////////////////////////////////////////////

router.patch("/account-settings", async (req: MulmRequest, res) => {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	const errors = new Map<string, string>();
	const parsed = updateSchema.safeParse(req.body);
	if (!parsed.success) {
		parsed.error.issues.forEach((issue) => {
			errors.set(String(issue.path[0]), issue.message);
		});

		res.render("account/settings", {
			viewer,
			//googleURL: await getGoogleLinkURL(req),
			errors,
		});
		return;
	}

	const form = parsed.data;

	try {
		if (form.current_password && form.password) {
			const currentPasswordEntry = getMemberPassword(viewer.id);
			// Not set, or we have correct password
			// Need better logic here...
			if (!currentPasswordEntry || await checkPassword(currentPasswordEntry, form.current_password)) {
				const passwordEntry = await makePasswordEntry(form.password)
				createOrUpdatePassword(viewer.id, passwordEntry)
				// Updated password!
			} else {
				errors.set("password", "Password incorrect");
			}
		}
	} catch (e: unknown) {
		console.error(e);
		errors.set("password", "Unknown error");
	}

	updateMember(viewer.id, {
		display_name: form.display_name,
		contact_email: form.email,
	});

	res.render("account/settings", {
		viewer: {
			display_name: form.display_name,
			contact_email: form.email,
			googleURL: await getGoogleOAuthURL(),
		},
		errors,
	});
});

// Regular Views ///////////////////////////////////////////////////

router.get("/", async (req: MulmRequest, res) => {
	console.log(req.cookies);
	const { viewer } = req;
	const isLoggedIn = Boolean(viewer);
	const isAdmin = viewer?.is_admin;

	const args = {
		title: "BAS BAP/HAP Portal",
		message: "Welcome to BAS!",
		googleURL: await getGoogleOAuthURL(),
		isLoggedIn,
		isAdmin,
	};

	let approvalsProgram;
	let approvalsCount = 0;
	if (isAdmin) {
		const counts = getOutstandingSubmissionsCounts();
		Object.entries(counts).forEach(([program, count]) => {
			if (count > 0) {
				approvalsProgram = program;
				approvalsCount += count;
			}
		});
	}

	res.render("index", {
		...args,
		approvalsProgram,
		approvalsCount,
	});
});

// Entrypoint for BAP/HAP submission
router.get("/submit", (req: MulmRequest, res) => {
	const { viewer } = req;
	const form = {
		// auto-fill member name and email if logged in
		member_name: viewer?.display_name,
		member_email: viewer?.contact_email,
		...req.query,
	};

	const selectedType = String(req.query.species_type ?? "Fish");
	res.render("submit", {
		title: getBapFormTitle(selectedType),
		form,
		errors: new Map(),
		classOptions: getClassOptions(selectedType),
		waterTypes,
		speciesTypes,
		foodTypes,
		spawnLocations,
		isLivestock: isLivestock(selectedType),
		isAdmin: Boolean(viewer?.is_admin),
	});
});

router.get("/account", async (req: MulmRequest, res) => {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	res.render("account/page", {
		title: "Account Settings",
		viewer,
		googleURL: await getGoogleOAuthURL(),
		errors: new Map(),
	});
});

// Add a line to the fertilizer list
router.get("/submit/addSupplement", (req, res) => {
	res.render("bapForm/supplementSingleLine");
});

router.get("/annual", async (req, res) => {
	const { year } = req.query;
	res.set("HX-Redirect", `/annual/${String(year)}`).send();
});

router.get("/annual/:stringYear{/:program}", async (req: MulmRequest, res) => {
	const { stringYear, program = "fish" } = req.params;
	const year = parseInt(stringYear);
	if (programs.indexOf(program) === -1) {
		res.status(404).send("Invalid program");
		return;
	}

	if (isNaN(year) || year < minYear) {
		res.status(422).send("Invalid year");
		return;
	}

	const startDate = new Date(year - 1, 7, 1);
	const endDate = new Date(year, 6, 31);

	const submissions = getApprovedSubmissionsInDateRange(
		startDate,
		endDate,
		program,
	);
	const names: Record<string, string> = {};
	// Collate approved submissions into standings
	const standings = new Map<number, number>();
	submissions.forEach((submission) => {
		const currentPoints = standings.get(submission.member_id) ?? 0;
		standings.set(
			submission.member_id,
			currentPoints + submission.total_points!,
		);
		names[submission.member_id] = submission.member_name;
	});

	const sortedStandings = Array.from(standings.entries()).sort(
		(a, b) => b[1] - a[1],
	);

	const title = (() => {
		switch (program) {
			default:
			case "fish":
				return `Breeder Awards Program`;
			case "plant":
				return `Horticultural Awards Program`;
			case "coral":
				return `Coral Awards Program`;
		}
	})();

	res.render("standings", {
		title,
		standings: sortedStandings,
		names,
		program,
		maxYear: 2025,
		minYear: 2015,
		year,
		isLoggedIn: Boolean(req.viewer),
	});
});

router.get("/lifetime{/:program}", async (req: MulmRequest, res) => {
	const { program = "fish" } = req.params;
	if (programs.indexOf(program) === -1) {
		res.status(404).send("Invalid program");
		return;
	}

	const levels: Record<string, Member[]> = {};
	const allSubmissions = getApprovedSubmissions(program);
	const totals = new Map<number, number>();
	for (const record of allSubmissions) {
		totals.set(
			record.member_id,
			(totals.get(record.member_id) || 0) + record.total_points,
		);
	}

	const members = getMembersList();
	for (const member of members) {
		const memberLevel =
			(() => {
				switch (program) {
					default:
					case "fish":
						return member.fish_level;
					case "plant":
						return member.plant_level;
					case "coral":
						return member.coral_level;
				}
			})() ?? "Participant";

		if (!levels[memberLevel]) {
			levels[memberLevel] = [];
		}
		levels[memberLevel]!.push({
			...member,
			points: totals.get(member.id) ?? 0,
		});
	}

	const levelsOrder = levelRules[program].map((rule) => rule[0]).reverse();
	const sortMembers = (a: Member, b: Member) => {
		const aPoints = a.points ?? 0;
		const bPoints = b.points ?? 0;
		return bPoints - aPoints;
	};

	const finalLevels = levelsOrder
		.map((name) => [
			name,
			(levels[name] ?? [])
				.sort(sortMembers)
				.filter((member) => member.points! > 0),
		])
		.filter(([, members]) => members.length > 0);

	const title = (() => {
		switch (program) {
			default:
			case "fish":
				return "Breeder Awards Program";
			case "plant":
				return "Horticultural Awards Program";
			case "coral":
				return "Coral Awards Program";
		}
	})();

	res.render("lifetime", {
		title,
		levels: finalLevels,
		isLoggedIn: Boolean(req.viewer),
	});
});


// Admin Views /////////////////////////////////////////////////////

router.get("/admin/members", async (req: MulmRequest, res) => {
	const { viewer } = req;
	if (!viewer?.is_admin) {
		res.status(403).send("Access denied");
		return;
	}

	const members = getRoster();

	res.render("admin/members", {
		title: "Member Roster",
		members,
	});
});

router.get("/admin/members/edit/:memberId", async (req: MulmRequest, res) => {
	const { viewer } = req;
	if (!viewer?.is_admin) {
		res.status(403).send("Access denied");
		return;
	}

	const fishLevels = levelRules.fish.map((level) => level[0]);
	const plantLevels = levelRules.plant.map((level) => level[0]);
	const coralLevels = levelRules.coral.map((level) => level[0]);

	const { memberId } = req.params;
	const id = parseInt(memberId);
	if (isNaN(id)) {
		res.status(422).send("Invalid member ID");
		return;
	}
	const member = getMember(id);

	res.render("admin/editMember", {
		member,
		fishLevels,
		plantLevels,
		coralLevels,
	});
});

router.patch("/admin/members/edit/:memberId", (req: MulmRequest, res) => {
	const { viewer } = req;
	if (!viewer?.is_admin) {
		res.status(403).send("Access denied");
		return;
	}

	const { memberId } = req.params;
	const id = parseInt(memberId);
	if (isNaN(id)) {
		res.status(422).send("Invalid member ID");
		return;
	}

	// TODO do i have to use some better-auth call instead?
	const parsed = memberSchema.parse(req.body);
	updateMember(id, {
		...parsed,
		is_admin: parsed.is_admin !== undefined ? 1 : 0,
	});
	// TODO can we get the result after the update instead of querying?
	const member = getMember(id);

	res.render("admin/singleMemberRow", { member });
});

router.get("/admin/queue{/:program}", async (req: MulmRequest, res) => {
	const { viewer } = req;
	if (!viewer?.is_admin) {
		res.status(403).send("Access denied");
		return;
	}
	const { program = "fish" } = req.params;
	if (programs.indexOf(program) === -1) {
		res.status(404).send("Invalid program");
		return;
	}

	const submissions = getOutstandingSubmissions(program);
	const programCounts = getOutstandingSubmissionsCounts();

	const subtitle = (() => {
		switch (program) {
			default:
			case "fish":
				return `Breeder Awards Program`;
			case "plant":
				return `Horticultural Awards Program`;
			case "coral":
				return `Coral Awards Program`;
		}
	})();

	res.render("admin/queue", {
		title: "Approval Queue",
		subtitle,
		submissions,
		program,
		programCounts,
	});
});

router.post("/admin/approve", adminApproveSubmission);

// Members /////////////////////////////////////////////////////////

router.get("/me", async (req: MulmRequest, res) => {
	const { viewer } = req;
	if (!viewer) {
		res.redirect("/");
		return;
	} else {
		res.redirect(`/member/${viewer.id}`);
		return;
	}
});

router.get("/member/:memberId", async (req: MulmRequest, res) => {
	const { viewer } = req;
	const { memberId } = req.params;
	const member = getMemberWithAwards(memberId);
	if (!member) {
		res.status(404).send("Member not found");
		return;
	}

	const isSelf = Boolean(viewer?.id == member.id);
	const isAdmin = Boolean(viewer?.is_admin);

	const submissions = getSubmissionsByMember(
		memberId,
		isSelf,
		isSelf || isAdmin,
	);

	const fishSubs = submissions.filter(
		(sub) => sub.species_type === "Fish" || sub.species_type === "Invert",
	);
	const plantSubs = submissions.filter((sub) => sub.species_type === "Plant");
	const coralSubs = submissions.filter((sub) => sub.species_type === "Coral");

	res.render("member", {
		member,
		fishSubs,
		plantSubs,
		coralSubs,
		isLoggedIn: Boolean(viewer),
		isSelf: viewer && viewer.id == member.id,
		isAdmin: viewer && viewer.is_admin,
	});
});

router.get("/sub/:subId", viewSubmission);
router.post("/sub", createSubmission);
router.patch("/sub/:subId", updateSubmission);
router.delete("/sub/:subId", deleteSubmission);


app.use(router);

const PORT = process.env.PORT || 4200;
app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
	console.log(`Server running at https://${config.domain}`);
});
