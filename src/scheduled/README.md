# Scheduled Tasks

Background jobs that run inside the app process. There is no cron: each job is
a timer started by `src/bootstrap.ts`, and only in live production
(`isLiveProduction()` in `src/utils/environment.ts`: `NODE_ENV=production` and
not staging). Staging, development and tests run none of them.

Prod scales to zero, so every job also runs once at startup to catch up on
anything missed while the machine was stopped, then daily at a fixed hour of
server time.

| Job | File | Daily at | What it does |
|---|---|---|---|
| Daily cleanup | `cleanup.ts` | 3:00 AM | Deletes expired password reset tokens (`auth_codes`) and runs the level sweep |
| Level sweep | `level-sweep.ts` | (part of cleanup) | Recalculates every member's award level from approved submissions; silent, sends no mail |
| Final-submission reminders | `finalSubmissionReminder.ts` | 4:00 AM | Emails members whose waiting period has elapsed; marks each sent only after delivery, so failures retry next run |
| Committee digest | `committeeDigest.ts` | 7:00 AM | Emails the committee what is still waiting on them; at most once per daily slot (last run kept in settings), so cold starts don't resend |

Nothing here deletes images from R2.

Each job exports a `start…`/`stop…` pair; `bootstrap.ts` stops them on
shutdown. A run in progress at shutdown is awaited.

## Tests

```bash
npm test -- src/__tests__/cleanup.test.ts
npm test -- src/__tests__/finalSubmissionReminder.test.ts
npm test -- src/__tests__/committeeDigest.test.ts
npm test -- src/__tests__/bootstrap.test.ts
```

## Monitoring

`flyctl logs --app basny-bap`. Each job logs its next scheduled run at startup
and a summary line per run (`Daily cleanup tasks completed successfully`,
`Final-submission reminders complete: sent=N, failed=N`, and so on). Errors are
logged and never crash the app.
