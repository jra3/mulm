# Routing

Routes follow RESTful conventions and are domain-organized in `src/routes/`. The application factory in `src/app.ts` registers handlers and mounts routers.

## RESTful Patterns

Standard REST conventions for resource routes:

```
GET    /resource         - List all (index)
GET    /resource/new     - New resource form
POST   /resource         - Create resource
GET    /resource/:id     - View single resource
GET    /resource/:id/edit - Edit resource form
PATCH  /resource/:id     - Update resource
DELETE /resource/:id     - Delete resource
```

## Route Modules

Route handlers are organized by domain:

- `src/routes/submission.ts` - Submission CRUD
- `src/routes/tank.ts` - Tank preset management
- `src/routes/account.ts` - User account settings
- `src/routes/auth.ts` - Authentication and OAuth
- `src/routes/member.ts` - Member profiles
- `src/routes/species.ts` - Species explorer
- `src/routes/standings.ts` - Program standings
- `src/routes/typeahead.ts` - Search APIs
- `src/routes/adminRouter.ts` - Admin-only routes (separate router with auth middleware)

## Selected Route Reference

### Public Routes

**Homepage & Navigation**
```
GET    /                     - Homepage with recent submissions
GET    /me                   - Redirect to viewer's profile
```

**Member Profiles**
```
GET    /member/:memberId     - View member profile
```

**Standings & Statistics**
```
GET    /lifetime{/:program} - Cumulative program standings
GET    /annual              - Redirect to the current awards year
GET    /annual/:stringYear{/:program} - Annual program standings
```

**Species Explorer**
```
GET    /species              - Species browser
GET    /species/:groupId     - Species group detail
```

### Authentication Routes

**Password Authentication**
```
POST   /auth/signup          - Create account
POST   /auth/login           - Password login
POST   /auth/logout          - Logout
```

**Password Reset**
```
GET    /auth/forgot-password - Validate forgot password token
POST   /auth/forgot-password - Send forgot password email
GET    /auth/set-password    - Validate set password token
POST   /auth/reset-password  - Reset password with token
```

**OAuth**
```
GET    /oauth/google         - Google OAuth callback (URL registered with Google)
POST   /oauth/apple          - Apple OAuth callback
```

**Auth Dialogs** (HTMX modals)
```
GET    /dialog/auth/signin          - Sign in dialog
GET    /dialog/auth/signup          - Sign up dialog
GET    /dialog/auth/forgot-password - Forgot password dialog
```

### Account Management

**User Settings**
```
GET    /account              - View account settings
PATCH  /account              - Update account settings
DELETE /account/google        - Unlink Google account (gets sub from session)
```

### Submissions

**Submission CRUD**
```
GET    /submissions/new              - New submission form
GET    /submissions/new/addSupplement - Add supplement line (HTMX partial)
POST   /submissions                  - Create submission
GET    /submissions/:id              - View submission
PATCH  /submissions/:id              - Update submission
DELETE /submissions/:id              - Delete submission
```

### Tank Presets

**Tank Management**
```
GET    /tank                 - View tank component (used in submission form)
GET    /tanks                - List saved tank presets
GET    /tanks/new            - New tank preset form (HTMX dialog)
POST   /tanks                - Create tank preset
PATCH  /tanks/:name          - Update tank preset (uses name, not ID)
DELETE /tanks/:name           - Delete tank preset
```

### API Routes

**Search/Typeahead** (JSON responses)
```
GET    /api/members/search     - Typeahead search for members
GET    /api/species/search     - Typeahead search for species
```

### Admin Routes

All admin routes are under `/admin/` prefix with admin auth middleware.

**Approval Queues**
```
GET    /admin/queue{/:program}          - Approval queue, phone first: every Program's ready rows, or one Program's; approved tonight; still waiting
GET    /admin/witness-queue{/:program}  - Witness confirmation queue
GET    /admin/waiting-period{/:program} - Waiting period queue
```

**Submission Management**
```
POST   /admin/submissions/:id/approve          - The one button: posts expected_total only; a stale total comes back as a sheet with the current one
POST   /admin/submissions/:id/bind-species     - Bind (or rebind) to a Species (witness panel; pendingWitness only)
POST   /admin/submissions/:id/adopt-species-classification - Take the bound Species' type and class (witness panel; pendingWitness only)
POST   /admin/submissions/:id/confirm-witness  - Confirm witness with the points, or with a new Species to record (refused while unbound)
POST   /admin/submissions/:id/witness-summary  - The witness panel's sticky bar, summed on the server (the correction form's too, with correction=1)
GET    /admin/submissions/:id/record-species   - The witness panel's Record new species step (creates nothing; ?correction=1 on the correction form)
POST   /admin/submissions/:id/record-species   - Record species and continue: the panel again, the new Species settled
GET    /admin/submissions/:id/correct-points   - The correction form (#528): the panel's cards over the current values, a reason, Save correction; with ?species_id= or ?group_id= and HX-Request, the panel alone with that Species settled
POST   /admin/submissions/:id/correct-points   - Save correction: Species and points in one write with a reason, from the Witness on
GET    /admin/submissions/:id/edit-approved    - The Edit Approved Submission dialog (#529): the member's details only, with a reason; links to the correction form for Species and points
POST   /admin/submissions/:id/edit-approved    - Save the details through editApprovedDetails: changelog entry, no email, no standings recompute
POST   /admin/submissions/:id/request-changes  - Request changes from submitter
```

**Admin Dialogs** (HTMX)
```
GET    /admin/dialog/submissions/:id/request-changes  - Request changes form
```

**Member Management**
```
GET    /admin/members                           - List members
GET    /admin/members/:memberId/edit            - Edit member form
PATCH  /admin/members/:memberId                 - Update member
POST   /admin/members/:memberId/check-levels    - Recalculate levels
POST   /admin/members/:memberId/check-specialty-awards - Check specialty awards
POST   /admin/members/:memberId/send-welcome    - Send welcome email
POST   /admin/members/invite                    - Invite new member
```

## Route Guidelines

### URL Parameter Naming

- Use `:id` for numeric database IDs (standard REST)
- Use descriptive names for non-ID params (`:memberId`, `:program`, `:groupId`)
- Tank presets use `:name` as identifier (legacy, unique constraint on name)

### HTMX Integration

- Partial templates return fragments, not full pages
- Use `hx-get`, `hx-post`, `hx-patch`, `hx-delete` with resource URLs
- Dialog routes under `/dialog/` namespace return modal HTML
- Admin dialogs under `/admin/dialog/` namespace

### Special Cases

- **OAuth callback** (`/oauth/google`) cannot change - registered with Google
- **Optional parameters**: Some routes support optional parameters with `{/:param}` syntax
- **Backward compatibility**: Submission validation accepts both `:id` and `:subId`

## Handler and authentication conventions

Import `MulmRequest` from `@/sessions`; its optional viewer has `id`, `display_name`, `contact_email` and optional admin/level fields. Member-only handlers check the viewer explicitly. See `viewAccountSettings` and `updateAccountSettings` in [`account.ts`](account.ts): both return 401 when the viewer is missing and use `viewer.id` for member queries.

[`adminRouter.ts`](adminRouter.ts) installs `requireAdmin` from [`admin.ts`](admin.ts) with `adminRouter.use(requireAdmin)`. It returns 401 for an absent viewer and 403 for a non-admin. Handlers registered there do not repeat the admin-role check; resource ownership and lifecycle permissions still apply.

Use real form schemas and helpers: `bapForm`/`bapDraftForm` in `forms/submission.ts`, `updateSchema` in `forms/login.ts`, and `validateFormResult` in `forms/utils.ts`. For request strings, use `getBodyString` / `getQueryString` from `utils/request.ts`. See [`submission.ts`](submission.ts) for form rendering and calls to the [Submission lifecycle](../lifecycle/README.md).

HTMX handlers render the relevant Pug fragment directly (for example `account/settings`); ordinary page handlers render the page template. Follow the existing template's contract rather than adding a generic `layout: false` flag. See [view conventions](../views/README.md).

## Route registration and middleware

[`createApp`](../app.ts) imports named handler modules such as `* as submission` and `* as account`, then binds them to paths. Modules that export an Express router, including `adminRouter`, `collection` and `routes/api/upload`, are mounted with `use`. [`bootstrap.ts`](../bootstrap.ts) initializes process resources before accepting traffic; constructing the app alone does not initialize the database.

The production stack in `app.ts` includes cookie/body parsing, `sessionMiddleware` from `sessions.ts`, origin validation, session-token CSRF validation and route-specific rate limiters. Apple’s cross-site `POST /oauth/apple` callback is registered before the origin/CSRF middleware and validates the OAuth state cookie in its authentication handler. Google uses `GET /oauth/google`. See `middleware/originValidation.ts`, `middleware/csrfValidation.ts` and `middleware/rateLimiter.ts`.

Upload handling is configured in [`api/upload.ts`](api/upload.ts). Development/test routes are guarded in `app.ts`; they are not available in production.

## Witness and correction form preparation

[`forms/witnessPanel.ts`](../forms/witnessPanel.ts) owns the Species facts, initial values, available bonus
controls and matching total for both the Witness and correction forms. Routes
load the panel and render it; `witnessPanel.pug` reads the prepared `pointsForm`
values instead of reconstructing defaults. Summary refreshes use the same bonus
availability rule over the posted controls, so choices made after a reset stay.

The cross-Program bonus reset on the correction form is a domain rule owned by
[`CONTEXT.md`](../../CONTEXT.md) (Approved). Nothing is written until Confirm
witness or Save correction; the lifecycle still validates and performs each
write in its transaction.
