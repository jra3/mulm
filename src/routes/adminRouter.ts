import { Router } from "express";
import { requireAdmin } from "./admin";
import * as admin from "./admin";
import * as speciesAdmin from "./admin/species";
import * as iucnAdmin from "./admin/iucn";

const adminRouter = Router();

adminRouter.use(requireAdmin);

// Species management
adminRouter.get("/species", speciesAdmin.listSpecies);
adminRouter.get("/species/:groupId/edit", speciesAdmin.editSpeciesSidebar);
adminRouter.patch("/species/:groupId", speciesAdmin.updateSpecies);
adminRouter.delete("/species/:groupId", speciesAdmin.deleteSpecies);

// IUCN Red List management
adminRouter.get("/iucn", iucnAdmin.showDashboard);
adminRouter.post("/iucn/sync", iucnAdmin.syncSpecies);
adminRouter.get("/iucn/status", iucnAdmin.getSyncStatus);
adminRouter.get("/iucn/log", iucnAdmin.showSyncLog);
adminRouter.get("/iucn/missing", iucnAdmin.showMissingSpecies);

// Bulk operations
adminRouter.get("/dialog/species/bulk-set-points", speciesAdmin.bulkSetPointsDialog);
adminRouter.post("/species/bulk-set-points", speciesAdmin.bulkSetPointsAction);

// Merge species
adminRouter.get("/dialog/species/:groupId/merge", speciesAdmin.mergeSpeciesDialog);
adminRouter.post("/species/:groupId/merge", speciesAdmin.mergeSpeciesAction);

// Split name management (new schema)
adminRouter.get("/species/:groupId/common-names/new", speciesAdmin.addCommonNameForm);
adminRouter.post("/species/:groupId/common-names", speciesAdmin.addCommonNameRoute);
adminRouter.delete(
  "/species/:groupId/common-names/:commonNameId",
  speciesAdmin.deleteCommonNameRoute
);
adminRouter.get("/species/:groupId/scientific-names/new", speciesAdmin.addScientificNameForm);
adminRouter.post("/species/:groupId/scientific-names", speciesAdmin.addScientificNameRoute);
adminRouter.delete(
  "/species/:groupId/scientific-names/:scientificNameId",
  speciesAdmin.deleteScientificNameRoute
);

// Deprecated synonym routes (old paired schema - keep for backwards compatibility)
adminRouter.get("/species/:groupId/synonyms/new", speciesAdmin.addSynonymForm);
adminRouter.post("/species/:groupId/synonyms", speciesAdmin.addSynonymRoute);
adminRouter.delete("/species/:groupId/synonyms/:nameId", speciesAdmin.deleteSynonym);

adminRouter.get("/queue{/:program}", admin.showQueue);
adminRouter.get("/witness-queue{/:program}", admin.showWitnessQueue);
adminRouter.get("/waiting-period{/:program}", admin.showWaitingPeriod);

adminRouter.post("/submissions/:id/approve", admin.approveSubmission);
adminRouter.get("/submissions/:id/approval-bonuses", admin.getApprovalBonuses);
adminRouter.get("/submissions/:id/edit", admin.viewEditSubmission);
adminRouter.get("/submissions/:id/edit-approved", admin.editApprovedSubmissionForm);
adminRouter.post("/submissions/:id/edit-approved", admin.saveApprovedSubmissionEdits);

adminRouter.get("/members", admin.viewMembers);
adminRouter.get("/members/:memberId/edit", admin.viewMemberUpdate);
adminRouter.get("/members/:memberId/row", admin.viewMemberRow);
adminRouter.patch("/members/:memberId", admin.updateMemberFields);
adminRouter.post("/members/:memberId/check-levels", admin.checkMemberLevels);
adminRouter.post("/members/:memberId/check-specialty-awards", admin.checkMemberSpecialtyAwards);
adminRouter.post("/members/:memberId/send-welcome", admin.sendWelcomeEmail);
adminRouter.post("/members/invite", admin.inviteMember);

adminRouter.post("/submissions/:id/confirm-witness", admin.confirmWitnessAction);
adminRouter.post("/submissions/:id/decline-witness", admin.declineWitnessAction);
adminRouter.post("/submissions/:id/request-changes", admin.sendRequestChanges);
adminRouter.post("/submissions/:id/notes", admin.addSubmissionNote);
adminRouter.get("/submissions/:submissionId/notes/:noteId/edit", admin.editSubmissionNoteForm);
adminRouter.get("/submissions/:submissionId/notes/:noteId/cancel", admin.cancelEditSubmissionNote);
adminRouter.patch("/submissions/:submissionId/notes/:noteId", admin.updateSubmissionNote);
adminRouter.delete("/submissions/:submissionId/notes/:noteId", admin.deleteSubmissionNote);

adminRouter.get("/dialog/submissions/:id/decline-witness", admin.declineWitnessForm);
adminRouter.get("/dialog/submissions/:id/request-changes", admin.requestChangesForm);

export default adminRouter;
