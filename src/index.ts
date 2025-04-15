import Koa from 'koa';
import Router from 'koa-router';
import views from 'koa-views';
import serve from 'koa-static';
import path from 'path';
import bodyParser from 'koa-bodyparser';
import { createSubmission, getApprovedSubmissions, getApprovedSubmissionsInDateRange, getOutstandingSubmissions, getOutstandingSubmissionsCounts, getSubmissionById, getSubmissionsByMember } from "./db/submissions";
import { bapSchema, getBapFormTitle, foodTypes, getClassOptions, isLivestock, spawnLocations, waterTypes, speciesTypes, bapFormHeader } from "./forms/submission";
import { createMember, getGoogleAccount, getMember, getMemberByEmail, getMemberWithAwards, getMembersList, Member, createGoogleAccount, getRoster, updateMember } from "./db/members";
import { levelRules, minYear, programs } from "./programs";
import { getGoogleOAuthURL, getGoogleUser, translateGoogleOAuthCode } from "./oauth";

import config from './config.json';
import { createUserSession, destroyUserSession, MulmContext, sessionMiddleware } from "./sessions";
import { updateSubmission, viewSubmission, deleteSubmission, adminApproveSubmission } from "./routes/submissions";
import { memberSchema } from "./forms/member";
import { onSubmissionSend } from "./notifications";
import { ZodIssue } from "zod";

const app = new Koa();

app.use(bodyParser());
app.use(serve(path.join(__dirname, '../public')));
app.use(
	views(path.join(__dirname, 'views'), {
		extension: 'pug',
	})
);

app.use(sessionMiddleware)

const router = new Router();

router.get("/logout", async (ctx) => {
	destroyUserSession(ctx);
	ctx.redirect("/");
});

router.post("/login", async (ctx) => {
	console.log(ctx.request.body);
	ctx.redirect("/");
});

// Regular Views ///////////////////////////////////////////////////

router.get("/", async (ctx: MulmContext) => {
	const viewer = ctx.loggedInUser;
	const isLoggedIn = Boolean(viewer);
	const isAdmin = viewer?.is_admin;

	const args = {
		title: 'BAS BAP/HAP Portal',
		message: 'Welcome to BAS!',
		googleURL: getGoogleOAuthURL(),
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

	await ctx.render('index', {
		...args,
		approvalsProgram,
		approvalsCount,
		isLoggedIn: Boolean(viewer),
	});
});

// Entrypoint for BAP/HAP submission
router.get('/submit', async (ctx: MulmContext) => {
	const viewer = ctx.loggedInUser;
	const form = {
		// auto-fill member name and email if logged in
		member_name: viewer?.member_name,
		member_email: viewer?.member_email,
		// TODO members should only be able to submit for themselves
		// TODO admins can submit for others
		...ctx.query,
	}

	const selectedType = String(ctx.query.species_type ?? "Fish");
	await ctx.render('submit', {
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

// Add a line to the fertilizer list
router.get('/submit/addSupplement', async (ctx) => {
	await ctx.render('bapForm/supplementSingleLine');
});

router.get('/annual', async (ctx) => {
	ctx.set('HX-Redirect', `/annual/${ctx.query.year}`);
})
router.get('/annual/:year{/:program}', async (ctx: MulmContext) => {
	const program = String(ctx.params.program ?? "fish");
	if (programs.indexOf(program) === -1) {
		ctx.status = 404;
		ctx.body = "Invalid program";
		return;
	}

	const year = parseInt(ctx.params.year);
	if (isNaN(year) || year < minYear) {
		ctx.status = 422;
		ctx.body = "Invalid year";
		return;
	}

	const startDate = new Date(year - 1, 7, 1);
	const endDate = new Date(year, 6, 31);

	const submissions = getApprovedSubmissionsInDateRange(startDate, endDate, program);
	const names: Record<number, string> = {};
	// Collate approved submissions into standings
	const standings = new Map<number, number>();
	submissions.forEach((submission) => {
		const currentPoints = standings.get(submission.member_id) ?? 0;
		standings.set(submission.member_id, currentPoints + submission.total_points!);
		names[submission.member_id] = submission.member_name;
	});

	const sortedStandings = Array.from(standings.entries()).sort((a, b) => b[1] - a[1]);

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

	await ctx.render('standings', {
		title,
		standings: sortedStandings,
		names,
		program,
		maxYear: 2025,
		minYear: 2015,
		year,
		isLoggedIn: Boolean(ctx.loggedInUser),
	});
});

router.get('/lifetime{/:program}', async (ctx: MulmContext) => {
	const program = String(ctx.params.program ?? "fish");
	if (programs.indexOf(program) === -1) {
		ctx.status = 404;
		ctx.body = "Invalid program";
		return;
	}

	const levels: Record<string, Member[]> = {};

	const allSubmissions = getApprovedSubmissions(program);
	const totals = new Map<number, number>();
	for (const record of allSubmissions) {
		totals.set(
			record.member_id,
			(totals.get(record.member_id) || 0) + record.total_points);
	}

	const members = getMembersList();
	for (const member of members) {
		const memberLevel = (() => {
			switch (program) {
				default:
				case "fish":
					return member.fish_level
				case "plant":
					return member.plant_level
				case "coral":
					return member.coral_level
			}
		})() ?? "Participant";

		if (!levels[memberLevel]) {
			levels[memberLevel] = [];
		}
		levels[memberLevel]!.push({...member, points: totals.get(member.id) ?? 0});
	}

	const levelsOrder = levelRules[program].map(rule => rule[0]).reverse()
	const sortMembers = (a: Member, b: Member) => {
		const aPoints = a.points ?? 0;
		const bPoints = b.points ?? 0;
		return bPoints - aPoints;
	}

	const finalLevels = levelsOrder
		.map(name => [name, (levels[name] ?? []).sort(sortMembers).filter(member => member.points! > 0)])
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

	await ctx.render('lifetime', {
		title,
		levels: finalLevels,
		isLoggedIn: Boolean(ctx.loggedInUser),
	});
});

// Admin Views /////////////////////////////////////////////////////

router.get('/admin/members', async (ctx: MulmContext) => {
	if (!ctx.loggedInUser?.is_admin) {
		ctx.status = 403;
		ctx.body = "Access denied";
		return;
	}

	const members = getRoster();

	await ctx.render('admin/members', {
		title: 'Member Roster',
		members,
	});
});

router.get('/admin/members/edit/:memberId', async (ctx: MulmContext) => {

	if (!ctx.loggedInUser?.is_admin) {
		ctx.status = 403;
		ctx.body = "Access denied";
		return;
	}

	const memberId = parseInt(ctx.params.memberId);
	if (!memberId) {
		ctx.status = 400;
		ctx.body = "Invalid member id";
		return;
	}

	const fishLevels = levelRules.fish.map(level => level[0]);
	const plantLevels = levelRules.plant.map(level => level[0]);
	const coralLevels = levelRules.coral.map(level => level[0]);

	const member = getMember(memberId);

	await ctx.render('admin/editMember', {
		member,
		fishLevels,
		plantLevels,
		coralLevels,
	});

});

router.patch('/admin/members/edit/:memberId', async (ctx: MulmContext) => {
	if (!ctx.loggedInUser?.is_admin) {
		ctx.status = 403;
		ctx.body = "Access denied";
		return;
	}

	const memberId = parseInt(ctx.params.memberId);
	if (!memberId) {
		ctx.status = 400;
		ctx.body = "Invalid member id";
		return;
	}

	const parsed = memberSchema.parse(ctx.request.body)

	updateMember(memberId, {
		...parsed,
		is_admin: parsed.is_admin !== undefined ? 1 : 0,
	});

	const member = getMember(memberId);
	await ctx.render('admin/singleMemberRow', { member });
});

router.get('/admin/queue{/:program}', async (ctx: MulmContext) => {
	if (!ctx.loggedInUser?.is_admin) {
		ctx.status = 403;
		ctx.body = "Access denied";
		return;
	}

	const program = String(ctx.params.program ?? "fish");
	if (programs.indexOf(program) === -1) {
		ctx.status = 404;
		ctx.body = "Invalid program";
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

	await ctx.render('admin/queue', {
		title: 'Approval Queue',
		subtitle,
		submissions,
		program,
		programCounts
	});
})

router.post('/admin/approve', adminApproveSubmission);

// Members /////////////////////////////////////////////////////////

router.get('/me', async (ctx: MulmContext) => {
	const viewer = ctx.loggedInUser;
	if (!viewer) {
		ctx.redirect('/');
		return;
	} else {
		ctx.redirect(`/member/${viewer.member_id}`);
		return;
	}
});

router.get('/member/:memberId', async (ctx: MulmContext) => {
	const memberId = parseInt(ctx.params.memberId);
	if (!memberId) {
		ctx.status = 400;
		ctx.body = "Invalid member id";
		return;
	}

	const member = getMemberWithAwards(memberId);
	if (!member) {
		ctx.status = 404;
		ctx.body = "Member not found";
		return;
	};

	const viewer = ctx.loggedInUser;

	const isSelf = Boolean(viewer?.member_id == member.id);
	const isAdmin = Boolean(viewer?.is_admin);
	const submissions = getSubmissionsByMember(memberId, isAdmin, isSelf);

	const fishSubs = submissions.filter(sub => sub.species_type === "Fish" || sub.species_type === "Invert");
	const plantSubs = submissions.filter(sub => sub.species_type === "Plant");
	const coralSubs = submissions.filter(sub => sub.species_type === "Coral");

	await ctx.render('member', {
		member,
		fishSubs,
		plantSubs,
		coralSubs,
		isLoggedIn: Boolean(viewer),
		isSelf: viewer && viewer.member_id == member.id,
		isAdmin: viewer && viewer.is_admin,
	});

});

// Submissions /////////////////////////////////////////////////////

router.get('/sub/:subId', viewSubmission);

// Save a new submission, potentially submitting it
router.post('/sub', async (ctx: MulmContext) => {
	const viewer = ctx.loggedInUser;

	if (!viewer) {
		ctx.status = 403;
		ctx.body = "You must be logged in to submit";
		return;
	}

	const ensureMember = (email: string, name: string) => {
		let member = getMemberByEmail(email);
		let memberId: number;
		if (!member) {
			if (viewer.is_admin) {
				// create a placeholder member
				memberId = createMember(email, name);
				member = getMember(memberId)!;
			} else {
				ctx.status = 403;
				ctx.body = "User cannot submit for this member";
				return;
			}
		} else {
			memberId = member.id;
		}
		return memberId;
	}

	const returnFormErrors = async (issues: ZodIssue[]) => {
		const errors = new Map<string, string>();
		issues.forEach((issue) => {
			errors.set(String(issue.path[0]), issue.message);
		});

		const {
			species_type: selectedType
		} = ctx.request.body as { species_type: string };

		await ctx.render('bapForm/form', {
			title: getBapFormTitle(selectedType),
			form: ctx.request.body,
			errors,
			classOptions: getClassOptions(selectedType),
			waterTypes,
			speciesTypes,
			foodTypes,
			spawnLocations,
			isLivestock: isLivestock(selectedType),
			isAdmin: Boolean(viewer.is_admin),
		});
	}

	const header = bapFormHeader.safeParse(ctx.request.body);
	if (!header.success) {
		await returnFormErrors(header.error.issues);
		return;
	}

	if (header.data.member_email != viewer.member_email || header.data.member_name != viewer.member_name) {
		if (!viewer.is_admin) {
			ctx.status = 403;
			ctx.body = "User cannot submit for this member";
			return;
		}
	}

	if ("draft" in header.data) {
		console.log("saving draft!");
		const memberId = ensureMember(header.data.member_email, header.data.member_name);
		if (!memberId) {
			return;
		}
		createSubmission(memberId, ctx.request.body, false) {

		return;
	}

	const form = bapSchema.safeParse(ctx.request.body);
	if (!form.success) {
		await returnFormErrors(form.error.issues);
		return;
	}

	let member = getMemberByEmail(form.data.member_email);
	let memberId: number;
	if (!member) {
		if (viewer.is_admin) {
			// create a placeholder member
			memberId = createMember(form.data.member_email, form.data.member_name);
			member = getMember(memberId)!;
		} else {
			// should be impossible to get here
			ctx.status = 403;
			ctx.body = "User cannot submit for this member";
			return;
		}
	} else {
		memberId = member.id;
	}

	const subId = createSubmission(memberId, form.data, true);
	const sub = getSubmissionById(subId);
	if (!sub) {
		ctx.status = 500;
		ctx.body = "Failed to create submission";
		return;
	}

	onSubmissionSend(sub, member)
	ctx.body = "Submitted " + String(subId);
	await ctx.render('submission/success', {
		member,
		subId,
	});
});

router.patch('/sub/:subId', updateSubmission);
router.delete('/sub/:subId', deleteSubmission);

// OAuth ////////////////////////////////////////////////////

router.get("/oauth/google", async (ctx) => {
	const qs = new URLSearchParams(ctx.request.querystring);
	const code = qs.get("code");

	const resp = await translateGoogleOAuthCode(String(code));
	const payload = await resp.json();
	if (!("access_token" in payload)) {
		ctx.body = "Login Failed!";
		return;
	}
	const token = String(payload.access_token);
	const googleUser = await getGoogleUser(token);
	const record = getGoogleAccount(googleUser.sub);

	if (!record) {
		const member = getMemberByEmail(googleUser.email);
		if (member) {
			createGoogleAccount(member.id, googleUser.sub);
			createUserSession(ctx, member.id);
		} else {
			const memberId = createMember(googleUser.email, googleUser.name);
			createUserSession(ctx, memberId);
		}
	} else {
		const member = getMember(record.member_id)
		if (!member) {
			ctx.body = "Problem with account!";
			ctx.status = 500;
			return;
		}
		createUserSession(ctx, member.id as number);
	}

	ctx.redirect("/");
});

app.use(router.routes()).use(router.allowedMethods());
const PORT = process.env.PORT || 4200;
app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
	console.log(`Server running at https://${config.domain}`);
});
