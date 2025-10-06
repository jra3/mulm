import { Router } from "express";
import { requireAdmin } from "./admin";
import * as admin from "./admin";

const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get("/queue{/:program}", admin.showQueue);
adminRouter.get("/witness-queue{/:program}", admin.showWitnessQueue);
adminRouter.get("/waiting-period{/:program}", admin.showWaitingPeriod);

adminRouter.post("/submissions/:id/approve", admin.approveSubmission);

adminRouter.get("/edit{/:subId}", admin.viewEditSubmission);

adminRouter.get("/members", admin.viewMembers);
adminRouter.get("/members/:memberId/edit", admin.viewMemberUpdate);
adminRouter.get("/members/:memberId/row", admin.viewMemberRow);
adminRouter.patch("/members/:memberId", admin.updateMemberFields);
adminRouter.post("/members/:memberId/check-levels", admin.checkMemberLevels);
adminRouter.post("/members/:memberId/check-specialty-awards", admin.checkMemberSpecialtyAwards);
adminRouter.post("/members/:memberId/send-welcome", admin.sendWelcomeEmail);

adminRouter.post("/confirm-witness/:subId", admin.confirmWitnessAction);
adminRouter.post("/decline-witness/:subId", admin.declineWitnessAction);

adminRouter.get("/dialog/decline-witness/:subId", admin.declineWitnessForm);

adminRouter.post("/invite", admin.inviteMember);

adminRouter.get("/dialog/request-changes/:subId", admin.requestChangesForm);
adminRouter.post("/submissions/:subId/request-changes", admin.sendRequestChanges);

export default adminRouter;
