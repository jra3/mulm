import Koa from 'koa';
import Router from 'koa-router';
import views from 'koa-views';
import serve from 'koa-static';
import path from 'path';
import bodyParser from 'koa-bodyparser';
import { getMembersList, MemberDetails } from "./data";
import { addSubmission, approveSubmission, getOutstandingSubmissions, Submission } from "./db/submissions";
import { z } from "zod";
import { text } from "stream/consumers";
import { foodTypes, getClassOptions, spawnLocations, speciesTypesAndClasses } from "./submissionSchema";

const app = new Koa();
app.use(bodyParser());
app.use(serve(path.join(__dirname, '..', 'public')));
app.use(
  views(path.join(__dirname, 'views'), {
    extension: 'pug',
  })
);

const router = new Router();

router.get('/', async (ctx) => {
  await ctx.render('index', { title: 'BAS BAP/HAP Portal', message: 'Welcome to BAS!' });
});

router.get('/admin/bap/queue', async (ctx) => {
  const submissions = getOutstandingSubmissions();
  // check for auth
  await ctx.render('queue', {
    title: 'BAP Submission Queue',
    submissions,
  });
})

router.get('/admin/sub/:subId', async (ctx) => {
  const subId = parseInt(ctx.params.subId);
  if (!subId) {
    ctx.status = 400;
    ctx.body = "Invalid input";
    return;
  }

  //const submission = getSubmissionById(subId);
  const submission: Submission = {
    id: subId,
    submission_date: new Date().toISOString(),
    member_name: "Alice",
    species_name: `Species ${subId}`,
  };

  await ctx.render('review', {
    submission,
    isAdmin: true,
  });

});

router.post('/admin/bap/approve', async (ctx) => {
  const { id, points, approvedBy } = ctx.request.body as {id?: number, points?: number, approvedBy?: string };
  if (!id || !points || !approvedBy) {
    ctx.status = 400;
    ctx.body = "Invalid input";
    return;
  }

  approveSubmission(id, points, approvedBy);
});

router.get('/bap/standings/:year', async (ctx) => {
  const year = parseInt(ctx.params.year);

  if (isNaN(year) || year < 2020) {
    ctx.status = 422;
    ctx.body = "Invalid year";
    return;
  }

  const startDate = new Date(year - 1, 7, 1);
  const endDate = new Date(year, 6, 31);

  // const submissions: {memberName: string, points: number, approvalDate?: Date}[] = getSubmissions(true, startDate, endDate);

  const approvalDate = new Date(year, 1, 1);
  const submissions = [
    { memberName: "Lucifer", points: 66, approvalDate },
    { memberName: "Alice", points: 100, approvalDate },
    { memberName: "Alice", points: 100, approvalDate },
    { memberName: "Alice", points: 100, approvalDate },
    { memberName: "Bob", points: 10, approvalDate },
    { memberName: "Lucifer", points: 600, approvalDate },
    // not approved
    { memberName: "Lucifer", points: 999 },
  ];

  const standings = new Map<string, number>();
  submissions.forEach((submission) => {
    console.log(submission);
    if (submission.approvalDate != null) {
      const currentPoints =  standings.get(submission.memberName) ?? 0;
      standings.set(submission.memberName, currentPoints + submission.points);
    }
  });

  const sortedStandings = Array.from(standings.entries()).sort((a, b) => b[1] - a[1]);
  await ctx.render('standings', {
    title: `Breeder Awards Standings for ${ctx.params.year}`,
    standings: sortedStandings,
  });
});


router.get('/bap/lifetime', async (ctx) => {

  const levels = new Map<string, MemberDetails[]>();

  for (const member of getMembersList()) {
    const level = member.level ?? "Participant";
    if (!levels.has(level)) {
      levels.set(level, []);
    }
    levels.get(level)!.push(member);
  }

  const levelsOrder = [
    "Participant",
    "Hobbyist",
    "Breeder",
    "Advanced Breeder",
    "Master Breeder",
    "Grand Master Breeder",
    "Legendary Breeder",
    "Senior Grand Master Breeder",
    "Premier Breeder",
    "Senior Premier Breeder",
    "Grand Poobah Yoda Breeder",
  ].filter((level) => levels.has(level)).reverse();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const [level, _] of levels) {
    levels.get(level)!.sort((a, b) => b.totalPoints - a.totalPoints);
  }

  await ctx.render('lifetime', {
    title: 'Breeder Awards Lifetime Standings',
    levels,
    levelsOrder,
  });
});

router.get('/bap/submit', async (ctx) => {
  await ctx.render('bap-submission', {
    title: 'BAP Submission',
    form: {
      speciesClass: "Fish",
    },
    classOptions: getClassOptions("Fish"),
    foodTypes,
    spawnLocations,
  });
});

router.post('/ajax/bap', async (ctx) => {
  // TODO zod validation
  const form = ctx.request.body as any;
  await ctx.render('bapForm/form', {
    form,
    classOptions: getClassOptions(form.speciesType as string),
  });
});

router.post('/bap/submit', async (ctx) => {
  console.log()
  const { memberName, speciesCommonName } = ctx.request.body as { memberName?: string, speciesCommonName?: string };
  console.log(ctx.request.body);

  if (!memberName || !speciesCommonName) {
    ctx.status = 400;
    ctx.body = "Invalid input";
    return;
  }
  console.log(ctx.request.body);
  addSubmission(memberName, speciesCommonName);
  ctx.body = "Submitted";
});

router.get('/ajax/selectType', async (ctx) => {
  const speciesType = ctx.query.speciesType as string ?? "Fish";
  const options = speciesTypesAndClasses[speciesType]!
  await ctx.render('onSelectType', {
    options: options.map(v => ({ value: v, text: v })),
    showLightAndFerts: speciesType === "Plant" || speciesType === "Coral",
  });
});

app.use(router.routes()).use(router.allowedMethods());

const PORT = process.env.PORT || 4200;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
