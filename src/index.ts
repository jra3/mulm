import Koa from 'koa';
import Router from 'koa-router';
import views from 'koa-views';
import serve from 'koa-static';
import path from 'path';
import bodyParser from 'koa-bodyparser';
import { addSubmission, approveSubmission, deleteSubmission, getApprovedSubmissions, getApprovedSubmissionsInDateRange, getOutstandingSubmissions, getSubmissionById, getSubmissionsByMember } from "./db/submissions";
import { bapSchema, foodTypes, getClassOptions, isLivestock, spawnLocations, waterTypes, speciesTypes } from "./submissionSchema";
import { getMemberData, getMembersList, getOrCreateMember } from "./db/members";
import { levelRules, minYear, programs } from "./programs";

const app = new Koa();
app.use(bodyParser());
app.use(serve(path.join(__dirname, '..', 'public')));
app.use(
	views(path.join(__dirname, 'views'), {
		extension: 'pug',
	})
);

const router = new Router();

// Regular Views ///////////////////////////////////////////////////

router.get('/', async (ctx) => {
	await ctx.render('index', { title: 'BAS BAP/HAP Portal', message: 'Welcome to BAS!' });
});

// Entrypoint for BAP/HAP submission
router.get('/submit', async (ctx) => {
	const selectedType = String(ctx.query.speciesType ?? "Fish");
	await ctx.render('submit', {
		title: 'BAP Submission',
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

	console.log(program)
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
	await ctx.render('standings', {
		title: `Breeder Awards Standings for ${ctx.params.year}`,
		standings: sortedStandings,
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
	const levelsOrder = levelRules[program].map(rule => rule[0])

	const allSubmissions = getApprovedSubmissions(program);

	const totals = new Map<number, number>();
	for (const record of allSubmissions) {
		totals.set(
			record.member_id,
			(totals.get(record.member_id) || 0) + record.points);
		}

		const memberNameMap = Object.fromEntries(getMembersList().map(entry => [entry.id, entry.name]));

		console.log(totals);

		const levels = {
			Participant: Object.entries(totals).sort((a, b) => a[1] - b[1]).map(entry => ({name: memberNameMap[entry[0]], totalPoints: entry[1]}))
		}

		console.log(levels);

		/*
		for (const [memberId, points] of totals) {
		levels.get(level)!.push(member);
		}

		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		for (const [level, _] of levels) {
		levels.get(level)!.sort((a, b) => b.totalPoints - a.totalPoints);
		}
		*/

		await ctx.render('lifetime', {
			title: 'Breeder Awards Lifetime Standings',
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
			await ctx.render('bapForm/form', {
				title: 'BAP Submission',
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

		const member = getOrCreateMember(parsed.data.memberName);
		addSubmission(member.id, parsed.data, true);
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

	app.use(router.routes()).use(router.allowedMethods());
	const PORT = process.env.PORT || 4200;
	app.listen(PORT, () => {
		console.log(`Server running at http://localhost:${PORT}`);
	});
