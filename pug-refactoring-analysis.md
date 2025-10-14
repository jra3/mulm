# Pug Template Analysis - Duplicate Markup & Refactoring Opportunities

## Task

Analyze all Pug templates in `src/views/` to identify:
1. Duplicate markup that should be extracted into mixins or includes
2. Scattered implementations of similar UI patterns
3. Inconsistent implementations of the same concept
4. Opportunities to consolidate and simplify

## Context

This is a Breeder Awards Program (BAP) web application using:
- **Pug templates** for server-side rendering
- **Tailwind CSS** for styling
- **HTMX** for dynamic interactions
- **Express.js** backend

## Specific Areas to Investigate

### 1. Form Patterns
Look for duplicate form input markup:
- Text inputs with labels
- Error message display patterns
- Button groups
- Form validation styling
- HTMX form submission patterns

**Expected findings:**
- Multiple implementations of "input with label and error"
- Inconsistent error display (some use `p.text-red-600`, others might differ)
- Button styling patterns repeated

### 2. Card/Container Patterns
Look for:
- Card layouts (bordered boxes with padding)
- List items with actions
- Action button groups (Edit/Delete patterns)
- Confirmation dialogs via hx-confirm

**Known issue:** Just fixed duplicate card markup between `tankPresets.pug` and `tankPresetCard.pug`. Check for similar issues elsewhere.

### 3. HTMX Interaction Patterns
Look for repeated HTMX patterns:
- Delete with confirmation (`hx-delete` + `hx-confirm`)
- Edit/Cancel toggle patterns
- Form submission with spinner
- Target/swap combinations

### 4. Navigation & Headers
Check for:
- Repeated header/navigation markup
- Breadcrumbs or page titles
- User menu/account links

### 5. Empty States
Look for:
- "No items found" messages
- Empty list displays
- Inconsistent wording or styling

## Files to Analyze

Priority files (known to have forms/cards):
- `src/views/account/*.pug`
- `src/views/admin/*.pug`
- `src/views/bapForm/*.pug`
- `src/views/activity/*.pug`
- `src/views/mixins/*.pug` (check if existing mixins are being used consistently)

## Output Format

For each finding, provide:

### Finding #N: [Short Description]

**Pattern:** [What's duplicated]

**Locations:**
- `path/to/file.pug:line`
- `path/to/file.pug:line`
- `path/to/file.pug:line`

**Current Implementation:**
```pug
[code snippet showing duplicate]
```

**Recommended Solution:**
```pug
[proposed mixin or include]
```

**Impact:**
- Lines of code reduced: ~XX
- Files affected: N
- Complexity: Low/Medium/High

**Priority:** High/Medium/Low

---

## Success Criteria

1. Identify at least 5-10 refactoring opportunities
2. Prioritize by impact (lines saved, consistency improved)
3. Flag any critical inconsistencies (same feature, different implementation)
4. Suggest concrete, implementable solutions

## Constraints

- Do NOT suggest changes that would break HTMX functionality
- Maintain existing accessibility patterns
- Keep mobile-responsive Tailwind classes
- Respect the current design system
- Do not over-engineer - simple includes/mixins only

## Additional Notes

Recent changes:
- Tank preset management was just added to account page
- There may still be old pattern usage in that new code
- The codebase uses mixins but maybe not consistently

Look for "easy wins" - obvious duplicates that would simplify maintenance.
