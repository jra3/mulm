# Routing

Routes follow RESTful conventions and are domain-organized in `src/routes/`. All routes are registered in `src/index.ts`.

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

## Complete Route Reference

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
GET    /standings{/:program} - Program standings (optional BAP/CARES filter)
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
GET    /auth/logout          - Logout
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
GET    /admin/queue{/:program}          - Approval queue
GET    /admin/witness-queue{/:program}  - Witness confirmation queue
GET    /admin/waiting-period{/:program} - Waiting period queue
```

**Submission Management**
```
POST   /admin/submissions/:id/approve          - Approve submission
GET    /admin/submissions/:id/edit             - Edit submission (admin view)
POST   /admin/submissions/:id/confirm-witness  - Confirm witness
POST   /admin/submissions/:id/decline-witness  - Decline witness
POST   /admin/submissions/:id/request-changes  - Request changes from submitter
```

**Admin Dialogs** (HTMX)
```
GET    /admin/dialog/submissions/:id/decline-witness  - Decline witness form
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

## Route Implementation Patterns

### Basic Route

```typescript
import { MulmRequest } from '@/types/request';
import { requireLogin } from '@/middleware/auth';

router.get('/resource', requireLogin, async (req: MulmRequest, res) => {
  const { viewer } = req; // Guaranteed by requireLogin

  const data = await getDataForViewer(viewer.member_id);

  res.render('resource-view', {
    viewer,
    data
  });
});
```

### Form Submission

```typescript
import { resourceFormSchema } from '@/forms/resource';

router.post('/resource', requireLogin, async (req: MulmRequest, res) => {
  const { viewer } = req;

  // Validate form
  const result = resourceFormSchema.safeParse(req.body);
  if (!result.success) {
    return res.render('resource-form', {
      viewer,
      errors: result.error.flatten().fieldErrors,
      formData: req.body
    });
  }

  // Process valid data
  const data = result.data;
  const id = await createResource(data);

  res.redirect(`/resource/${id}`);
});
```

### HTMX Partial

```typescript
router.get('/resource/partial', requireLogin, async (req: MulmRequest, res) => {
  const { viewer } = req;

  const data = await getData();

  // Render partial template (no layout)
  res.render('partials/resource-partial', {
    viewer,
    data,
    layout: false // Important: no layout for HTMX partials
  });
});
```

### API Endpoint (JSON)

```typescript
router.get('/api/resource/search', requireLogin, async (req: MulmRequest, res) => {
  const query = req.query.q as string;

  const results = await searchResource(query);

  res.json(results);
});
```

### Admin Route

```typescript
import { requireAdmin } from '@/middleware/auth';

router.get('/admin/resource', requireAdmin, async (req: MulmRequest, res) => {
  const { viewer } = req; // Guaranteed to be admin

  const data = await getAllData();

  res.render('admin/resource', {
    viewer,
    data
  });
});
```

## Route Registration

Routes are registered in `src/index.ts`:

```typescript
import submissionRouter from '@/routes/submission';
import tankRouter from '@/routes/tank';
import accountRouter from '@/routes/account';
import authRouter from '@/routes/auth';
import memberRouter from '@/routes/member';
import speciesRouter from '@/routes/species';
import standingsRouter from '@/routes/standings';
import typeaheadRouter from '@/routes/typeahead';
import adminRouter from '@/routes/adminRouter';

// Register routes
app.use('/', submissionRouter);
app.use('/', tankRouter);
app.use('/', accountRouter);
app.use('/', authRouter);
app.use('/', memberRouter);
app.use('/', speciesRouter);
app.use('/', standingsRouter);
app.use('/api', typeaheadRouter);
app.use('/admin', adminRouter);
```

## Middleware

Common middleware used in routes:

- **`requireLogin`** - Require authenticated user (redirects to signin if not)
- **`requireAdmin`** - Require admin role (returns 403 if not admin)
- **`upload.single('field')`** - Handle file upload (multer middleware)

See `src/middleware/` for implementation details.
