import Koa from 'koa';
import Router from 'koa-router';
import views from 'koa-views';
import serve from 'koa-static';
import path from 'path';
import bodyParser from 'koa-bodyparser';
import { addSubmission, approveSubmission, deleteSubmission, getApprovedSubmissions, getApprovedSubmissionsInDateRange, getOutstandingSubmissions, getSubmissionById, getSubmissionsByMember } from "./db/submissions";
import { bapSchema, foodTypes, getClassOptions, isLivestock, spawnLocations, waterTypes, speciesTypes } from "./submissionSchema";
import { getMemberData, getMembersList, getOrCreateMember, MemberRecord } from "./db/members";
import { levelRules, minYear, programs } from "./programs";
import { getGoogleOAuthURL, getGoogleUser, translateGoogleOAuthCode } from "./oauth";

import config from './config.json';
import { createUserSession, destroyUserSession, sessionMiddleware } from "./sessions";

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

// Regular Views ///////////////////////////////////////////////////

router.get('/', async (ctx) => {
	const user = (ctx as any).loggedInUser;

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

router.get('/logout', async (ctx) => {
	destroyUserSession(ctx);
	ctx.redirect("/");
});


// Entrypoint for BAP/HAP submission
router.get('/submit', async (ctx) => {
	const selectedType = String(ctx.query.speciesType ?? "Fish");

	const title = (() => {
		switch (selectedType) {
			default:
			case "Fish":
			case "Invert":
				return "Breeder Awards Submission";
			case "Plant":
				return "Horticultural Awards Submission";
			case "Coral":
				return "Coral Awards Submission";
		}
	})();

	await ctx.render('submit', {
		title,
		form: ctx.query,
		errors: new Map(),
		classOptions: getClassOptions(selectedType),
		waterTypes,
		speciesTypes,
		foodTypes,
		spawnLocations,
		isLivestock: isLivestock(selectedType),
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

	// Collate approved submissions into standings
	const standings = new Map<string, number>();
	submissions.forEach((submission) => {
		const currentPoints = standings.get(submission.member_name) ?? 0;
		standings.set(submission.member_name, currentPoints + submission.points!);
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

	// TODO add levels grouping back
	const levelsOrder = levelRules[program].map(rule => rule[0]).reverse()

	const allSubmissions = getApprovedSubmissions(program);
	const totals = new Map<number, number>();
	for (const record of allSubmissions) {
		totals.set(
			record.member_id,
			(totals.get(record.member_id) || 0) + record.points);
	}

	const members = getMembersList();

	const levels = new Map<string, (MemberRecord & { points: number })[]>(
		levelsOrder.map(level => [level, []])
	);

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

		levels.get(memberLevel)!.push({...member, points: totals.get(member.id) ?? 0});
	}

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

	// TOD0 Remove members with 0 points
	// TODO remove levels with no members

	await ctx.render('lifetime', {
		title,
		levels,
		levelsOrder,
	});
});

// Admin Views /////////////////////////////////////////////////////

router.get('/admin/queue{/:program}', async (ctx) => {
	const program = String(ctx.params.program ?? "fish");
	if (programs.indexOf(program) === -1) {
		ctx.status = 404;
		ctx.body = "Invalid program";
		return;
	}
	const submissions = getOutstandingSubmissions(program);

	// TODO check for auth
	await ctx.render('admin/queue', {
		title: 'Submission Queue',
		submissions,
		program,
	});
})

// This is a specializatin on router.patch('/sub/:subId'), we could get by with
// one version
router.post('/admin/approve', async (ctx) => {
	// TODO zod validation
	// TODO auth
	console.log(ctx.request.body);
	const { id, points, approvedBy } = ctx.request.body as { id?: number, points?: number, approvedBy?: string };
	if (!id || !points || !approvedBy) {
		ctx.status = 400;
		ctx.body = "Invalid input";
		return;
	}
	approveSubmission(id, points, approvedBy);

	ctx.set('HX-Redirect', '/admin/queue');
});

// Members /////////////////////////////////////////////////////////

router.get('/member/:memberId', async (ctx) => {
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

	const submissions = getSubmissionsByMember(memberId);
	await ctx.render('member', {
		member,
		submissions,
	});
});

// Submissions /////////////////////////////////////////////////////

async function viewSub(ctx: Koa.ParameterizedContext, isAdmin: boolean) {
	const subId = parseInt(ctx.params.subId);

	if (!subId) {
		ctx.status = 400;
		ctx.body = "Invalid submission id";
		return;
	}

	const submission = getSubmissionById(subId);
	if (!submission) {
		ctx.status = 404;
		ctx.body = "Submission not found";
		return;
	}

	await ctx.render('submission/review', {
		submission,
		isAdmin,
	});
}

router.get('/sub/:subId', async (ctx) => viewSub(ctx, false));
router.get('/admin/sub/:subId', async (ctx) => {
	// TODO do auth check
	return viewSub(ctx, true);
});

// Save a new submission, potentially submitting it
router.post('/sub', async (ctx) => {
	const parsed = bapSchema.safeParse(ctx.request.body);
	if (!parsed.success) {

		const errors = new Map<string, string>();
		parsed.error.issues.forEach((issue) => {
			errors.set(String(issue.path[0]), issue.message);
		});

		const selectedType = String(ctx.query.speciesType ?? "Fish");
		const title = (() => {
			switch (selectedType) {
				default:
				case "Fish":
				case "Invert":
					return "Breeder Awards Submission";
				case "Plant":
					return "Horticultural Awards Submission";
				case "Coral":
					return "Coral Awards Submission";
			}
		})();

		await ctx.render('bapForm/form', {
			title,
			form: ctx.request.body,
			errors,
			classOptions: getClassOptions(selectedType),
			waterTypes,
			speciesTypes,
			foodTypes,
			spawnLocations,
			isLivestock: isLivestock(selectedType),
		});
		return;
	}


//	const member = getOrCreateMember(parsed.data.parsed.data.memberName);
// 	addSubmission(member.id, parsed.data, true);

	ctx.body = "Submitted";
});

// Admin can always update
// User can update if not submitted
router.patch('/sub/:subId', async (ctx) => {
	const subId = parseInt(ctx.params.subId);

	if (!subId) {
		ctx.status = 400;
		ctx.body = "Invalid submission id";
		return;
	}

	console.log("Implement patch");
})

// Admin can always delete
// User can delete if not approved
router.delete('/sub/:subId', async (ctx) => {
	const subId = parseInt(ctx.params.subId);

	if (!subId) {
		ctx.status = 400;
		ctx.body = "Invalid submission id";
		return;
	}
	deleteSubmission(subId);
})

// OAuth

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
