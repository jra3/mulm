import { Router } from "express";
import { requireAdmin } from "./admin";
import * as admin from "./admin";
import * as speciesAdmin from "./admin/species";

const adminRouter = Router();

adminRouter.use(requireAdmin);

// Species management
adminRouter.get("/species", speciesAdmin.listSpecies);
adminRouter.get("/species/:groupId/edit", speciesAdmin.editSpeciesSidebar);
adminRouter.patch("/species/:groupId", speciesAdmin.updateSpecies);

adminRouter.get("/queue{/:program}", admin.showQueue);
adminRouter.get("/witness-queue{/:program}", admin.showWitnessQueue);
adminRouter.get("/waiting-period{/:program}", admin.showWaitingPeriod);

adminRouter.post("/submissions/:id/approve", admin.approveSubmission);
adminRouter.get("/submissions/:id/edit", admin.viewEditSubmission);

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
