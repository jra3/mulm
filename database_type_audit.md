# Database Type Audit Report

## Summary of Issues Found

### 1. **tank_presets table** - Missing `filter_type` field in TypeScript
- **Database**: Has `filter_type TEXT DEFAULT NULL`
- **TypeScript** (`src/db/tank.ts`): Missing `filter_type` field in `Tank` type
- **Impact**: Cannot save or retrieve filter type for tank presets

### 2. **awards table** - Type mismatch for `member_id`
- **Database**: `member_id INTEGER`
- **TypeScript** (`src/db/members.ts`): `member_id: string` in `AwardRecord` type
- **Impact**: Type errors when working with awards

### 3. **Sessions** - No TypeScript type definition
- **Database**: Has `sessions` table with fields: `session_id`, `member_id`, `expires_on`
- **TypeScript**: No corresponding type definition found
- **Impact**: No type safety for session operations

### 4. **species_name** and **species_name_group** - No TypeScript types
- **Database**: Both tables exist with proper schemas
- **TypeScript**: No dedicated type definitions (only query result types)
- **Impact**: Reduced type safety for species operations

### 5. **google_account** - No TypeScript type
- **Database**: Has table with `google_sub`, `google_email`, `member_id`
- **TypeScript**: Only inline query types, no dedicated type
- **Impact**: No reusable type for Google account operations

### 6. **password_account** - Partial type coverage
- **Database**: Has full table schema
- **TypeScript**: Has `ScryptPassword` type but missing `member_id` field
- **Impact**: Incomplete type definition

### 7. **auth_codes** - Missing field in TypeScript
- **Database**: Has `expires_on DATETIME NOT NULL`
- **TypeScript** (`src/auth.ts`): `expires_on: Date` (correct type but should verify usage)
- **Status**: OK but should verify Date handling

### 8. **activity_feed** - Type appears complete
- **Status**: OK

### 9. **members** - Type appears complete
- **Status**: OK

### 10. **submissions** - Recently fixed
- **Status**: OK (just fixed missing fields)

## Recommendations

### High Priority Fixes

1. Fix `Tank` type to include `filter_type` field
2. Fix `AwardRecord` type - change `member_id` from string to number
3. Create proper `Session` type definition

### Medium Priority

1. Create dedicated types for `SpeciesName` and `SpeciesNameGroup`
2. Create `GoogleAccount` type
3. Update `ScryptPassword` to include `member_id` field or create separate `PasswordAccount` type

### Code Organization

Consider creating a `src/types/database.ts` file to centralize all database table type definitions for better maintainability.