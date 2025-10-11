# Frontend: Pug Templates & Design System

Views use Pug templates with HTMX for interactivity, styled with Tailwind CSS.

## Directory Structure

```
views/
├── mixins/           # Reusable Pug mixins (date.pug, forms.pug, etc.)
├── partials/         # HTMX partial templates
├── layouts/          # Page layouts
│   └── base.pug      # Base layout with header/footer
└── *.pug             # Page templates
```

## Pug Template Guidelines

### Common Pitfalls

- ❌ **Mixed quotes**: `div(class="max-w-4xl" id='container')`
- ❌ **Long single lines**: Tailwind chains over 140 characters
- ❌ **SVG viewBox**: Must be lowercase `viewbox` in Pug (not `viewBox`)
- ❌ **Dot notation with colons**: `div.hover:bg-blue-500` breaks - colons in Tailwind modifiers are incompatible with Pug's dot syntax

### Best Practices

- ✅ **Use double quotes**: `div(class="max-w-4xl mx-auto")`
- ✅ **Break long class chains**:
  ```pug
  div(
    class="bg-gradient-to-r from-yellow-50 to-amber-50" +
          " rounded-lg shadow-lg p-6"
  )
  ```
- ✅ **Simple utilities only with dot notation**: `div.flex.gap-4.items-center`
- ✅ **Use class attribute for modifiers**: `div(class="hover:bg-blue-500 md:flex focus:outline-none")`
- ✅ **Use predefined component classes**: `button.primary` instead of full Tailwind button classes

## Color Palette & Design System

The app uses a structured color system with Tailwind CSS utility classes for consistency and semantic meaning.

### Background Colors

- `bg-white` - Main content areas, cards, table backgrounds (pristine content)
- `bg-gray-100` - Page sections and content area backgrounds (subtle grouping)
- `bg-gray-200` - Dialogs, sidebars, dropdowns, modal backgrounds (elevated surfaces)
- `bg-gray-300` - Footer, form controls disabled state (muted elements)
- `bg-gray-50` - Table headers, hover states (subtle highlights)
- `bg-gray-700` - Admin notes section (dark/serious admin areas)
- `bg-gray-800` - Divider lines in forms (strong separators)

### Text Colors

- `text-gray-800` - Primary body text (default for all pages)
- `text-gray-900` - Headings, emphasized text (stronger emphasis)
- `text-gray-700` - Secondary headings (medium emphasis)
- `text-gray-600` - Secondary/descriptive text (de-emphasized)
- `text-gray-500` - Muted text, placeholders, empty states (low priority)
- `text-gray-400` - Subtle hints, "Former Admin" labels (very subtle)

### Semantic Colors

Status badges use a consistent pattern: `bg-{color}-100 text-{color}-800` for badges, `bg-{color}-50` for row backgrounds:

**Blue** (`bg-blue-50/100`, `text-blue-600/700/800/900`)
- Primary actions, pending approval, links, informational states
- Buttons: `button.primary` uses `bg-blue-500 hover:bg-blue-700`
- Status: "Pending Review" submissions
- Links: Active navigation, clickable items
- Info panels: Witness verification info, waiting period display

**Red** (`bg-red-50/100/400/500`, `text-red-400/600/800`)
- Errors, destructive actions, denied states
- Buttons: `button.destructive` uses `bg-red-500 hover:bg-red-700`
- Form errors: `class="error"` applies `border-red-500`
- Error messages: `text-red-400` or `text-red-600`
- Status: Denied submissions
- Badge counts: Queue counts on buttons

**Green** (`bg-green-50/100/600`, `text-green-600/800`)
- Success, approved states, positive metrics
- Status: Approved submissions
- Activity: Submission approved icons
- Metrics: Point displays, breed counts
- Action buttons: Save buttons in admin

**Yellow** (`bg-yellow-50/100`, `text-yellow-400/600/700/800`)
- Warnings, draft state, awards
- Status: Draft submissions
- Warnings: Validation warnings in species explorer
- Activity: Award granted icons
- Alerts: "Witness needed" warnings

**Orange** (`bg-orange-50/100`, `text-orange-800`)
- Waiting period status
- Status: Submissions in their waiting period

**Purple** (`bg-purple-50/100`, `text-purple-800`)
- Pending witness verification
- Status: Needs witness verification

### Component-Specific Colors

- **Cards**: `bg-white rounded-lg shadow-md` (white on gray-100 backgrounds)
- **Tables**: `bg-white` with `bg-gray-50` headers and `hover:bg-gray-50` rows
- **Borders**: `border-gray-200/300` for subtle dividers
- **Shadows**: `shadow-sm/md/lg` for depth hierarchy
- **Links**: `text-gray-500 hover:text-black` (default), `text-blue-600 hover:text-blue-800` (in content)

## Predefined CSS Classes

Use these component classes from `src/index.css` instead of long Tailwind chains:

### Links
```css
.link              /* Links: gray-500 with hover:underline hover:text-black */
.link.light        /* Light links: white with hover:text-gray-200 */
```

### Buttons
```css
button.primary     /* Blue primary action buttons */
button.destructive /* Red destructive action buttons */
button.outline     /* Gray outline buttons */
```

### Forms
```css
.text-input        /* Standard text input styling */
.text-input.error  /* Input with red border for errors */
.input-label       /* Form label styling */
```

### Cards & Panels
```css
.card                    /* White card with shadow and padding */
.status-panel            /* Base panel for submission status */
.status-panel-pending    /* Blue panel for pending states */
.status-panel-warning    /* Yellow panel for warnings */
.status-panel-admin      /* Dark gray panel for admin sections */
```

## Status Badge Pattern

All submission statuses follow this consistent pattern:

```typescript
{
  status: 'approved',
  label: 'Approved',
  color: 'text-green-800',      // Dark text
  bgColor: 'bg-green-100',       // Light background
  rowColor: 'bg-green-50',       // Very light row highlight
  description: 'Details...'
}
```

### Status Color Map

- **Draft**: `bg-yellow-100 text-yellow-800` with 📝 icon
- **Pending Witness**: `bg-purple-100 text-purple-800` with 👁️ icon
- **Waiting Period**: `bg-orange-100 text-orange-800` with ⏳ icon
- **Pending Review**: `bg-blue-100 text-blue-800` with 🔵 icon
- **Approved**: `bg-green-100 text-green-800` with ✅ icon
- **Denied**: `bg-red-100 text-red-800` with ❌ icon

## Choosing Colors

When adding new features:

1. **Interactive elements** - Use blue (`bg-blue-500/600/700` or `button.primary`)
2. **Success/completion** - Use green (`bg-green-100 text-green-800`)
3. **Warnings/caution** - Use yellow (`bg-yellow-50 border-yellow-400`)
4. **Errors/deletion** - Use red (`bg-red-500` or `button.destructive`)
5. **Neutral info** - Use gray scale (`bg-gray-100`, `text-gray-600`)

**Avoid**: Using colors outside this palette. Don't introduce new semantic colors (teal, pink, indigo) unless they serve a distinct, necessary purpose.

## Date Formatting

**IMPORTANT**: All date formatting must use centralized utilities and mixins for consistency and accessibility.

### Date Utilities

Located in `src/utils/dateFormat.ts`:

```typescript
import { formatShortDate, formatLongDate, formatRelativeDate, formatISODate, isValidDate } from '@/utils/dateFormat';

// Compact format for tables
formatShortDate('2025-01-15') // "01/15/2025"

// Long format for detailed views
formatLongDate('2025-01-15') // "January 15, 2025"

// Relative format for activity feeds
formatRelativeDate('2025-10-04') // "3 days ago"

// ISO format for datetime attributes
formatISODate('2025-01-15') // "2025-01-15T00:00:00.000Z"

// Validate before formatting
if (isValidDate(dateString)) {
  // format it
}
```

### Pug Date Mixins

Located in `src/views/mixins/date.pug`:

```pug
include mixins/date.pug

//- Short format (MM/DD/YYYY) - for tables
+shortDate(submission.submitted_on)

//- Long format (Month DD, YYYY) - for detailed views
+longDate(submission.approved_on, "Approved on")

//- Relative format (X days ago) - for activity feeds
+relativeDate(activity.created_at)

//- Flexible format
+dateTime(date, 'short')  // or 'long', 'relative'
```

### When to Use Each Format

- **shortDate** - Tables, lists, compact displays (MM/DD/YYYY)
- **longDate** - Emails, formal contexts, detailed views ("January 15, 2025")
- **relativeDate** - Activity feeds, recent events ("3 days ago")
- **Server-side formatting** - Only for form fields/disabled inputs (use `formatShortDate()`)

### Key Rules

- ✅ **Always use mixins in templates** - They generate proper `<time>` elements
- ✅ **Use local timezone** - Dates display in user's local timezone to match calendar dates
- ✅ **Handle null/undefined** - All utilities return empty string for invalid dates
- ✅ **Provide aria-labels** - Second parameter adds context for screen readers
- ❌ **Never use** `.toLocaleDateString()` or `.toDateString()` directly
- ❌ **Never format dates** in route handlers unless needed for form fields

### Database Storage

- Always store dates as ISO strings using `new Date().toISOString()`
- Display formatting happens at the presentation layer only (templates)
- Never store formatted dates in the database

## HTMX Integration

### HTMX Attributes

Common HTMX patterns used:

```pug
//- GET request - load content
button(hx-get="/api/resource" hx-target="#result")

//- POST request - submit form
form(hx-post="/resource" hx-target="#result")

//- DELETE request - remove item
button(hx-delete="/resource/123" hx-confirm="Are you sure?")

//- Swap strategies
div(hx-get="/resource" hx-swap="outerHTML")    // Replace element
div(hx-get="/resource" hx-swap="innerHTML")    // Replace content
div(hx-get="/resource" hx-swap="beforeend")    // Append to end
```

### Partial Templates

HTMX partials should not include layout:

```pug
//- partials/resource-item.pug
div.resource-item
  h3= resource.name
  p= resource.description
```

Route handler:

```typescript
res.render('partials/resource-item', {
  resource,
  layout: false // Important: no layout for HTMX partials
});
```

## Template Structure

### Base Layout

All pages extend `layouts/base.pug`:

```pug
extends layouts/base

block title
  title My Page | Mulm BAP

block content
  .container
    h1 My Page
    p Content goes here
```

### Including Mixins

```pug
include mixins/date.pug
include mixins/forms.pug

//- Use mixins
+shortDate(date)
+textInput('name', 'Name', formData.name, errors.name)
```

## Accessibility

- Use semantic HTML (`<nav>`, `<main>`, `<article>`, etc.)
- Provide `aria-label` for icons and buttons without text
- Use `<time>` elements for dates (mixins handle this)
- Ensure sufficient color contrast (design system colors are compliant)
- Form inputs have associated `<label>` elements
