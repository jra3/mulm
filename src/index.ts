import Koa from 'koa';
import Router from 'koa-router';
import views from 'koa-views';
import serve from 'koa-static';
import path from 'path';
import bodyParser from 'koa-bodyparser';
import { createSubmission, getApprovedSubmissions, getApprovedSubmissionsInDateRange, getOutstandingSubmissions, getSubmissionsByMember } from "./db/submissions";
import { bapSchema, foodTypes, getClassOptions, isLivestock, spawnLocations, waterTypes, speciesTypes } from "./submissionSchema";
import { getMemberData, getMembersList, getOrCreateMember, MemberRecord } from "./db/members";
import { levelRules, minYear, programs } from "./programs";
import { getGoogleOAuthURL, getGoogleUser, translateGoogleOAuthCode } from "./oauth";

import config from './config.json';
import { createUserSession, destroyUserSession, MulmContext, sessionMiddleware } from "./sessions";
import { updateSubmission, viewSubmission, deleteSubmission, adminApproveSubmission } from "./routes/submissions";
import { getBapFormTitle } from "./views/submission/utils";

const app = new Koa();

app.use(bodyParser());
app.use(serve(path.join(__dirname, '..', 'public')));
app.use(
	views(path.join(__dirname, 'views'), {
		extension: 'pug',
	})
);

app.use(sessionMiddleware)

const router = new Router();

router.get('/logout', async (ctx) => {
	destroyUserSession(ctx);
	ctx.redirect("/");
});

// Regular Views ///////////////////////////////////////////////////

router.get('/', async (ctx: MulmContext) => {
	const user = ctx.loggedInUser;
	const isLoggedIn = Boolean(user);
	const isAdmin = user?.is_admin;

	await ctx.render('index', {
		title: 'BAS BAP/HAP Portal',
		message: 'Welcome to BAS!',
		googleURL: getGoogleOAuthURL(),
		isLoggedIn,
		isAdmin,
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
router.get('/annual/:year{/:program}', async (ctx) => {
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
		standings.set(submission.member_id, currentPoints + submission.points!);
		names[submission.member_id] = submission.member_name;
	});

	const sortedStandings = Array.from(standings.entries()).sort((a, b) => b[1] - a[1]);

	const title = (() => {
		switch (program) {
			default:
			case "fish":
				return `Breeder Awards Standings for ${year}`;
			case "plant":
				return `Horticultural Awards Standings for ${year}`;
			case "coral":
				return `Coral Awards Standings for ${year}`;
		}
	})();

	await ctx.render('standings', {
		title,
		standings: sortedStandings,
		names,
		year,
	});
});

router.get('/lifetime{/:program}', async (ctx) => {
	const program = String(ctx.params.program ?? "fish");
	if (programs.indexOf(program) === -1) {
		ctx.status = 404;
		ctx.body = "Invalid program";
		return;
	}

	const levels: Record<string, MemberRecord[]> = {};

	const allSubmissions = getApprovedSubmissions(program);
	const totals = new Map<number, number>();
	for (const record of allSubmissions) {
		totals.set(
			record.member_id,
			(totals.get(record.member_id) || 0) + record.points);
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
	const sortMembers = (a: MemberRecord, b: MemberRecord) => {
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
				return "Breeder Awards Lifetime Standings";
			case "plant":
				return "Horticultural Awards Lifetime Standings";
			case "coral":
				return "Coral Awards Lifetime Standings";
		}
	})();

	await ctx.render('lifetime', {
		title,
		levels: finalLevels,
	});
});

// Admin Views /////////////////////////////////////////////////////

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
	await ctx.render('admin/queue', {
		title: 'Submission Queue',
		submissions,
		program,
	});
})

router.post('/admin/approve', adminApproveSubmission);

// Members /////////////////////////////////////////////////////////

router.get('/member/:memberId', async (ctx: MulmContext) => {
	const memberId = parseInt(ctx.params.memberId);
	if (!memberId) {
		ctx.status = 400;
		ctx.body = "Invalid member id";
		return;
	}

	const member = getMemberData(memberId);
	if (!member) {
		ctx.status = 404;
		ctx.body = "Member not found";
		return;
	};

	const viewer = ctx.loggedInUser;

	const isSelf = Boolean(viewer?.member_id == member.id);
	const isAdmin = Boolean(viewer?.is_admin);
	const submissions = getSubmissionsByMember(memberId, isSelf, isAdmin);

	const fishSubs = submissions.filter(sub => sub.species_type === "Fish" || sub.species_type === "Invert");
	const plantSubs = submissions.filter(sub => sub.species_type === "Plant");
	const coralSubs = submissions.filter(sub => sub.species_type === "Coral");

	await ctx.render('member', {
		member,
		fishSubs,
		plantSubs,
		coralSubs,
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

	const parsed = bapSchema.safeParse(ctx.request.body);
	if (!parsed.success) {
		const errors = new Map<string, string>();
		parsed.error.issues.forEach((issue) => {
			errors.set(String(issue.path[0]), issue.message);
		});

		const {
			species_type: selectedType
		} = ctx.request.body as {species_type: string};

		console.log(parsed.error.issues);

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
		return;
	}

	const form = parsed.data;
	if (form.member_email != viewer.member_email || form.member_name != viewer.member_name) {
		if (!viewer.is_admin) {
			ctx.status = 403;
			ctx.body = "User cannot submit for this member";
			return;
		}
		// Admins can supply any member
	}

	const member = getOrCreateMember(form.member_email, form.member_name);
	const subId = createSubmission(member.id, form, true);

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
	const member = getOrCreateMember(googleUser.email, googleUser.name);

	createUserSession(ctx, member.id);

	ctx.redirect("/");
});

app.use(router.routes()).use(router.allowedMethods());
const PORT = process.env.PORT || 4200;
app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
	console.log(`Server running at https://${config.domain}`);
});
