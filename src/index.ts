import Koa from 'koa';
import Router from 'koa-router';
import views from 'koa-views';
import path from 'path';
import { getWriteDBConnecton } from "./db/conn";
import bodyParser from 'koa-bodyparser';
import { getMembersList, MemberDetails } from "./data";
import { addSubmission } from "./db/submissions";

const app = new Koa();

const router = new Router();

app.use(bodyParser());

app.use(
    views(path.join(__dirname, 'views'), {
      extension: 'pug',
    })
  );

router.get('/', async (ctx) => {
  await ctx.render('index', { title: 'Home Page', message: 'Welcome to BAS!' });
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
  await ctx.render('bap-submission', { title: 'BAP Submission' });
});

router.post('/bap/submit', async (ctx) => {
  const { memberName, speciesCommonName } = ctx.request.body as {memberName?: string, speciesCommonName?: string};

  if (!memberName || !speciesCommonName) {
    ctx.status = 400;
    ctx.body = "Invalid input";
    return;
  }

  addSubmission(memberName, speciesCommonName);
  ctx.body = "Submitted";

});

app.use(router.routes()).use(router.allowedMethods());

const PORT = process.env.PORT || 4200;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
