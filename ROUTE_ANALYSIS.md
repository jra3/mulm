# URL Route Analysis and Inconsistencies

## Current Route Groups

### ✅ **Well-Structured Routes**

#### **Submissions (`/sub/`)**
- `GET /sub/:subId` - View submission
- `POST /sub` - Create submission  
- `PATCH /sub/:subId` - Update submission
- `DELETE /sub/:subId` - Delete submission
**Status**: ✅ Perfect RESTful structure

#### **Species (`/species/`)**
- `GET /species` - List/explore species
- `GET /species/:groupId` - View species detail
**Status**: ✅ Good structure

#### **API (`/api/`)**
- `GET /api/members/search` - Search members
- `GET /api/species/search` - Search species  
**Status**: ✅ Consistent API structure

#### **Admin Members (`/admin/members/`) - RECENTLY FIXED**
- `GET /admin/members` - List members
- `GET /admin/members/:memberId/edit` - Edit member form
- `GET /admin/members/:memberId/row` - Member row partial
- `PATCH /admin/members/:memberId` - Update member
- `POST /admin/members/:memberId/check-levels` - Check member levels
- `POST /admin/members/:memberId/check-specialty-awards` - Check awards
**Status**: ✅ Now properly RESTful

### ⚠️ **Inconsistent Route Groups**

#### **1. Tank Management Routes - FIXED** ✅
```
GET  /tank              - Tank form (can receive preset data via query params)
GET  /tank/save         - Save tank form
GET  /tank/load         - Load tank list
POST /tank              - Create tank preset
PATCH /tank/:name       - Update tank preset
DELETE /tank/:name      - Delete tank preset
```
**Status**: ✅ **Fixed** - Consolidated under `/tank/` namespace
- Moved `/sidebar/saveTank` → `/tank/save`
- Moved `/sidebar/loadTank` → `/tank/load` 
- All routes now under consistent `/tank/` namespace
- Uses `:name` identifier (appropriate for user-named presets)
- Routes match actual workflow: presets are loaded into forms, not viewed standalone

#### **2. Account Management - FIXED** ✅
```
GET    /account         - View account settings
PATCH  /account         - Update account settings  
DELETE /account/google/:sub - Unlink Google account
```
**Status**: ✅ **Fixed** - Consistent URL patterns
- Fixed `PATCH /account-settings` → `PATCH /account`
- Updated template references
- Google unlink keeps `:sub` (matches Google's OAuth subject identifier)

#### **3. Admin Routes - PARTIALLY FIXED** ✅
```
GET  /admin/queue{/:program}                        - View approval queue
POST /admin/submissions/:id/approve                 - Approve specific submission ✅
GET  /admin/edit{/:subId}                          - Edit submission form 
POST /admin/invite                                  - Invite member
POST /admin/submissions/:subId/request-changes      - Request changes ✅
```
**Status**: 🔄 **Partially Fixed** - Resource IDs added to submission actions
- Fixed `POST /admin/approve` → `POST /admin/submissions/:id/approve`
- Fixed `POST /admin/request-changes/:subId` → `POST /admin/submissions/:subId/request-changes`
- Updated template references

**Remaining issues**:
- `/admin/invite` should be under `/admin/members/`
- `/admin/edit` could be consolidated with submission routes

#### **4. Dialog Routes - FIXED** ✅
```
GET /dialog/auth/signin                     - Sign in dialog ✅
GET /dialog/auth/signup                     - Sign up dialog ✅
GET /dialog/auth/forgot-password            - Forgot password dialog ✅
GET /dialog/admin/request-changes/:subId    - Admin request changes dialog ✅
```
**Status**: ✅ **Fixed** - Organized by function
- Moved auth dialogs to `/dialog/auth/` namespace
- Moved admin dialogs to `/dialog/admin/` namespace  
- Updated all template references
- Clear separation between auth and admin functionality

#### **5. Authentication Routes - INCONSISTENT**
```
POST /signup           - Create account
POST /login            - Login
GET  /logout           - Logout  
GET  /forgot-password  - Forgot password form
GET  /set-password     - Set password form
POST /forgot-password  - Send forgot password
POST /reset-password   - Reset password
GET  /oauth/google     - Google OAuth
```
**Issues**:
- Mixed verbs (some GET, some POST for similar actions)
- `/oauth/` separate from other auth routes
- No consistent `/auth/` prefix

**Should be**:
```
GET  /auth/signup          - Sign up form
POST /auth/signup          - Create account
GET  /auth/login           - Login form  
POST /auth/login           - Login
GET  /auth/logout          - Logout
GET  /auth/forgot-password - Forgot password form
POST /auth/forgot-password - Send forgot password
GET  /auth/reset-password  - Reset password form
POST /auth/reset-password  - Reset password
GET  /auth/oauth/google    - Google OAuth
```

#### **6. Submit Routes - INCONSISTENT NAMING**
```
GET /submit                 - New submission form
GET /submit/addSupplement   - Add supplement partial
```
**Issues**:
- Should follow RESTful `/submissions/` pattern to match `/sub/` routes

**Should be**:
```
GET /submissions/new            - New submission form  
GET /submissions/addSupplement  - Add supplement partial
```

## Priority Inconsistencies to Fix

### **✅ Completed Fixes**
1. **Tank routes** - ✅ Fixed: Consolidated under `/tank/` namespace
2. **Account routes** - ✅ Fixed: Consistent URL patterns
3. **Admin submission actions** - ✅ Fixed: Added resource IDs to URLs
4. **Dialog routes** - ✅ Fixed: Organized by function (`/dialog/auth/`, `/dialog/admin/`)

### **Remaining Work** 
5. **Auth routes** - Consolidate under `/auth/` prefix (extensive template changes)
6. **Submit routes** - Rename to match `/submissions/` pattern (extensive template changes)

## Summary

### ✅ **Phase 1 Complete: RESTful Violations Fixed**
- ✅ Fixed tank management routes - consolidated under `/tank/` namespace
- ✅ Fixed account settings route inconsistency - unified under `/account`
- ✅ Fixed admin approval/edit routes - added resource IDs to URLs
- ✅ Organized dialog routes by functionality - `/dialog/auth/` and `/dialog/admin/`

### 🔄 **Remaining Work: Extensive Template Changes**
- **Auth route consolidation** - Move all auth routes under `/auth/` prefix (requires updating many templates)
- **Submit route naming** - Rename `/submit/` to `/submissions/` to match resource pattern (requires updating many templates)
- **Admin route cleanup** - Move `/admin/invite` under `/admin/members/`

### **Impact**: 
Major route inconsistencies have been resolved. Remaining items are lower priority and require extensive template updates.