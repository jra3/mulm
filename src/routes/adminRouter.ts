import { Router } from "express";
import { requireAdmin } from "./admin";
import * as admin from "./admin";

const adminRouter = Router();

adminRouter.use(requireAdmin);

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

adminRouter.get("/dialog/submissions/:id/decline-witness", admin.declineWitnessForm);
adminRouter.get("/dialog/submissions/:id/request-changes", admin.requestChangesForm);

export default adminRouter;
