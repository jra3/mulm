# BAP Frontend Design Skill

This skill guides creation of frontend interfaces for the BAP (Breeder Awards Program) application. Follow this constitution to ensure consistency with existing patterns.

## Stack Overview

- **Templates:** Pug (server-side rendering)
- **Styling:** Tailwind CSS with custom component classes
- **Interactivity:** HTMX (no heavy JS frameworks)
- **Enhanced Inputs:** Tom Select for typeahead/multi-select
- **Tooltips:** Native Popover API via HoverCard component

## Design Philosophy

BAP uses a **utilitarian, content-focused** aesthetic:
- Clean white/gray backgrounds
- Semantic color coding for status
- Minimal decoration, maximum clarity
- Emoji-based visual markers for status/actions
- Responsive mobile-first design

---

## Color System

### Background Hierarchy

| Purpose | Class | Usage |
|---------|-------|-------|
| Primary content | `bg-white` | Cards, forms, main content areas |
| Page sections | `bg-gray-100` | Section backgrounds, alternating rows |
| Elevated surfaces | `bg-gray-200` | Dialogs, sidebars, modals |
| Table headers | `bg-gray-50` | Column headers |
| Footer | `bg-gray-300` | Page footer |

### Semantic Status Colors

All status indicators follow the pattern `bg-{color}-100 text-{color}-800` for badges, `bg-{color}-50` for row highlights:

| Status | Badge | Row | Emoji |
|--------|-------|-----|-------|
| Draft/Warning | `bg-yellow-100 text-yellow-800` | `bg-yellow-50` | 📝 |
| Pending Witness | `bg-purple-100 text-purple-800` | `bg-purple-50` | 👁️ |
| Waiting Period | `bg-orange-100 text-orange-800` | `bg-orange-50` | ⏳ |
| Pending Review | `bg-blue-100 text-blue-800` | `bg-blue-50` | 🔵 |
| Approved/Success | `bg-green-100 text-green-800` | `bg-green-50` | ✅ |
| Denied/Error | `bg-red-100 text-red-800` | `bg-red-50` | ❌ |
| Info/Primary | `bg-blue-50 border-blue-400` | - | ℹ️ |

**Rule:** Never introduce new colors. Use this palette consistently.

---

## CSS Component Classes

Use these predefined classes from `src/index.css` instead of long Tailwind chains:

```css
/* Links */
.link                    /* Gray-500 → black on hover, underline */
.link.light              /* White variant for dark backgrounds */

/* Buttons */
button.primary           /* Blue action buttons */
button.destructive       /* Red danger buttons */
button.outline           /* Gray outline buttons */

/* Form Inputs */
.text-input              /* Standard text/textarea input */
.text-input.error        /* Red border for validation errors */
.input-label             /* Label text styling */
.select-wrapper          /* Wrapper for custom select arrow */

/* Cards */
.card                    /* Basic white rounded card with shadow */

/* Status Panels */
.status-panel            /* Base panel styles */
.status-panel-pending    /* Blue left border */
.status-panel-warning    /* Yellow left border */
.status-panel-admin      /* Gray background */
```

---

## Pug Mixins

### Available Mixins (src/views/mixins/)

| Mixin | Purpose | Key Options |
|-------|---------|-------------|
| `+card(options)` | Container component | `variant`: default, activity, content, admin, info, warning, error, upload |
| `+emptyState(message, options)` | Empty state display | `emoji`, `subtitle`, `actionText`, `actionUrl`, `htmx` |
| `+progressBar(current, total, options)` | Progress indicator | `variant`: blue, green, gray; `showPercentage` |
| `+hoverCard(options)` | Tooltip with content | `side`, `width`, `delay`, `borderColor` |
| `+errorMessage(name)` | Form field error | Reads from `errors` object |
| `+shortDate(date)` | Date formatting | Also: `longDate`, `relativeDate` |
| `+caresBadge(options)` | CARES species badge | `size`: sm, md; `withHover` |
| `+iucnBadge(category, options)` | IUCN status badge | Color-coded by category |
| `+countBadge(count)` | Red notification badge | For counts |
| `+trophy(data)` | Trophy/achievement display | Member achievements |
| `+loadingSpinner()` | Loading indicator | For HTMX requests |

### Card Variants

```pug
//- Default: white with gray border
+card()
  p Content

//- Info message
+card({variant: 'info'})
  p This is informational

//- Warning message
+card({variant: 'warning'})
  p This needs attention

//- Upload zone
+card({variant: 'upload'})
  p Drag files here
```

### Empty States

```pug
//- Simple inline
+emptyState("No items found")

//- Hero style with emoji (for major empty states)
+emptyState("No Submissions Yet", {
  emoji: "🐠",
  size: "xl",
  subtitle: "Start your first submission to earn points"
})

//- With action button
+emptyState("No tank presets", {
  showCard: true,
  actionText: "Add Preset",
  actionUrl: "/account/tank-presets/new"
})

//- With HTMX action
+emptyState("No items", {
  actionText: "Add",
  htmx: { get: "/api/items/new", target: "#container" }
})
```

---

## Form Patterns

### Input Mixins (src/views/bapForm/inputs.pug)

```pug
include bapForm/inputs

//- Text input
+bapTextInput("Species Name", "name", "Enter species name")

//- Select dropdown
+bapSimpleSelectInput("Category", "category")
  option(value="fish") Fish
  option(value="plant") Plant

//- Multi-select (Tom Select)
+bapMultiSelectInput("Tags", "tags", "tags-select")
  option(value="1") Option 1
  option(value="2") Option 2

//- Typeahead with API
+bapTypeaheadInput({
  name: "species",
  label: "Species",
  apiUrl: "/api/species/search",
  placeholder: "Search species...",
  valueField: "group_id",
  labelField: "common_name",
  secondaryField: "scientific_name"
})
```

### Form Structure

```pug
form(method="POST" action="/submit")
  //- Two-column grid on desktop
  .grid.grid-cols-1.md:grid-cols-2.gap-4
    +bapTextInput("First Name", "first_name", "John")
    +bapTextInput("Last Name", "last_name", "Doe")

  //- Full width field
  .mt-4
    +bapTextInput("Email", "email", "john@example.com", "email")

  //- Submit button
  .mt-6
    button.primary(type="submit") Submit
```

### Validation Errors

The `errors` object is passed from the server. Inputs automatically show error state:

```pug
//- In route handler:
//- res.render('form', { errors: new Map([['email', 'Invalid email']]), form: req.body })

//- In template:
+bapTextInput("Email", "email", "Enter email")
//- Automatically shows red border and error message if errors.has('email')
```

---

## HTMX Patterns

### Basic Patterns

```pug
//- Load content into element
button(hx-get="/api/data" hx-target="#result") Load

//- Submit form via AJAX
form(hx-post="/api/submit" hx-swap="innerHTML")
  +bapTextInput("Name", "name", "")
  button.primary(type="submit") Save

//- Delete with confirmation
button.destructive(
  hx-delete="/api/item/123"
  hx-confirm="Are you sure?"
  hx-target="closest tr"
  hx-swap="outerHTML"
) Delete
```

### Loading Indicators

```pug
//- Button with spinner
button.primary(hx-post="/api/save" hx-indicator="#save-spinner")
  span Save
  +loadingSpinner()#save-spinner.htmx-indicator

//- Or use CSS classes
button.primary(hx-post="/api/save")
  span.htmx-indicator 🔄
  span Loading...
```

### Dialogs

```pug
//- Trigger dialog
button(hx-get="/dialog/edit" hx-target="body" hx-swap="beforeend") Edit

//- Dialog content (returned by server)
+dialog()
  h2 Edit Item
  form(hx-post="/api/save" hx-target="#result")
    +bapTextInput("Name", "name", item.name)
    button.primary(type="submit") Save
```

---

## Layout Patterns

### Page Section Structure

```pug
//- Standard section
section.bg-gray-100.py-8
  .max-w-7xl.mx-auto.px-4.sm:px-6.lg:px-8
    h2.text-2xl.font-bold.mb-4 Section Title
    //- Content here

//- White section
section.bg-white.py-8
  .max-w-7xl.mx-auto.px-4.sm:px-6.lg:px-8
    //- Content
```

### Responsive Grids

```pug
//- 1 col mobile, 2 cols tablet, 3 cols desktop
.grid.grid-cols-1.sm:grid-cols-2.lg:grid-cols-3.gap-4
  +card()
    p Card 1
  +card()
    p Card 2
  +card()
    p Card 3

//- Two column form layout
.grid.grid-cols-1.md:grid-cols-2.gap-4
  .flex.flex-col.gap-2
    //- Left column fields
  .flex.flex-col.gap-2
    //- Right column fields
```

### Flexbox Patterns

```pug
//- Horizontal with space between
.flex.items-center.justify-between.gap-4
  h2 Title
  button.primary Action

//- Icon + text
.flex.items-center.gap-2
  span 🐟
  span Fish Species

//- Vertical stack
.flex.flex-col.gap-2
  p Line 1
  p Line 2
```

---

## Accessibility Requirements

Every form input MUST have:

```pug
//- ✅ Correct
label.input-label(for="email") Email
input.text-input#email(
  name="email"
  aria-required="true"
  aria-invalid=errors.has('email') ? "true" : "false"
  aria-describedby=errors.has('email') ? "email-error" : undefined
)
if errors.has('email')
  span#email-error.text-red-500.text-sm(role="alert")= errors.get('email')

//- ❌ Wrong - no label, no aria attributes
input.text-input(name="email")
```

### Focus States

All interactive elements must show focus:

```pug
//- Buttons already have focus:ring-2 focus:ring-offset-2 via CSS
button.primary(type="submit") Submit

//- Links need visible focus
a.link(href="/page") Click here
```

### Status Communication

Never use color alone. Always pair with text/icon:

```pug
//- ✅ Correct - color + icon + text
span.bg-red-100.text-red-800.px-2.py-1.rounded ❌ Denied

//- ❌ Wrong - color only
span.bg-red-100.text-red-800.px-2.py-1.rounded Denied
```

---

## Component Examples

### Status Badge

```pug
span(class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800")
  | ✅ Approved
```

### Table with Sorting

```pug
table.min-w-full.divide-y.divide-gray-200(data-sortable)
  thead.bg-gray-50
    tr
      th.px-4.py-3.text-left.text-xs.font-medium.text-gray-500.uppercase Name
      th.px-4.py-3.text-left.text-xs.font-medium.text-gray-500.uppercase Date
      th.no-sort Actions
  tbody.bg-white.divide-y.divide-gray-200
    each item in items
      tr
        td.px-4.py-3= item.name
        td.px-4.py-3
          +shortDate(item.date)
        td.px-4.py-3
          a.link(href=`/item/${item.id}`) View
```

### Collapsible Section

```pug
details.bg-white.rounded-lg.shadow
  summary.px-4.py-3.cursor-pointer.font-medium Section Title
  .px-4.pb-4
    p Collapsible content here
```

---

## Don'ts

1. **Don't use dynamic imports** - Always static imports at top
2. **Don't use `require()`** - Use ES6 imports
3. **Don't introduce new colors** - Use the semantic color system
4. **Don't skip labels** - Every input needs an associated label
5. **Don't use `&&` in Pug attributes** - Use ternary operators
6. **Don't create inline styles** - Use Tailwind classes or CSS components
7. **Don't duplicate mixins** - Use existing mixins from src/views/mixins/
8. **Don't use generic fonts** - The system font stack is intentional

---

## File Locations

| Type | Location |
|------|----------|
| Pug templates | `src/views/` |
| Mixins | `src/views/mixins/` |
| Form components | `src/views/bapForm/` |
| CSS | `src/index.css` |
| Client JS | `src/public/` |
| HTMX | `src/public/htmx-2.0.4.js` |
| Tom Select | `src/public/tom-select.complete.min.js` |
| Typeahead init | `src/public/typeahead.js` |
| HoverCard | `src/public/js/hoverCard.js` |
