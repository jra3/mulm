# GitHub Issue Labeling Scheme

This document outlines the cohesive labeling scheme used for GitHub issues in the Mulm project.

## Label Categories

### 🎯 **Priority Labels**
- `priority:high` - High priority - should be addressed soon (red)
- `priority:medium` - Medium priority - important but not urgent (yellow)  
- `priority:low` - Low priority - nice to have (green)

### 🏷️ **Type Labels**
- `enhancement` - New feature or request (light blue)
- `bug` - Something isn't working (red)
- `documentation` - Improvements or additions to documentation (blue)

### 🛠️ **Domain Labels**
- `database` - Database schema, migrations, and data integrity (blue)
- `security` - Security improvements and vulnerability fixes (red)
- `performance` - Performance optimization and monitoring (yellow)
- `ui/ux` - User interface and user experience improvements (light blue)
- `testing` - Testing, test coverage, and quality assurance (dark blue)
- `infrastructure` - Infrastructure, deployment, and DevOps (purple)
- `accessibility` - Accessibility and WCAG compliance improvements (green)
- `forms` - Form handling, validation, and user input (light green)
- `admin-tools` - Admin interface and management tools (light pink)

### 🎯 **Feature-Specific Labels**
- `witnessed-submissions` - Related to the witnessed submission system (dark red)

### 👥 **Contributor Labels**
- `beginner-friendly` - Good for newcomers and junior developers (purple)
- `good first issue` - Good for newcomers (purple) *[existing]*
- `help wanted` - Extra attention is needed (teal) *[existing]*

## Labeling Guidelines

### Multiple Labels
Issues should have **2-4 labels** typically:
1. **One priority label** (required)
2. **One type label** (enhancement/bug/documentation)
3. **1-2 domain labels** (what area of code is affected)
4. **Optional**: Feature-specific or contributor labels

### Examples

**Good Labeling:**
- `priority:medium, enhancement, accessibility, forms, beginner-friendly`
- `priority:high, security, database`
- `priority:low, enhancement, ui/ux, admin-tools`

**Avoid Over-Labeling:**
- Don't use more than 5 labels per issue
- Don't use multiple priority labels
- Don't use conflicting labels

## Current Issue Distribution

### By Priority
- **High Priority (2)**: Security improvements, image upload
- **Medium Priority (6)**: Accessibility, database constraints, performance, testing
- **Low Priority (7)**: UX improvements, admin tools, logging

### By Domain
- **Database (4)**: Schema improvements, constraints, performance monitoring
- **Security (2)**: CSRF protection, secure uploads  
- **UI/UX (3)**: Pagination, HTMX standardization, photo attachments
- **Forms (3)**: Validation, missing fields, image uploads
- **Witnessed Submissions (4)**: Our new onboarding tasks

### Beginner-Friendly Issues
Issues tagged `beginner-friendly` are specifically designed for junior developers with:
- Detailed implementation guidance
- Clear acceptance criteria  
- Estimated time requirements
- All necessary context provided

**Current beginner-friendly issues:**
- #34: Accessibility improvements (2-3 days)
- #35: Database constraints (1-2 days) 
- #36: Date validation (1-2 days)

## Label Management

### Adding New Labels
When adding new labels, follow the naming convention:
- Use lowercase with hyphens: `new-feature-area`
- Include description explaining the label's purpose
- Choose colors that align with the category:
  - Red: High priority, security, bugs
  - Yellow: Medium priority, performance  
  - Green: Low priority, accessibility
  - Blue: Database, infrastructure, documentation
  - Purple: Infrastructure, contributor-focused

### Maintenance
- Review labels quarterly to ensure they're being used effectively
- Consolidate similar labels if they're redundant
- Update issue labels when priorities or scope change