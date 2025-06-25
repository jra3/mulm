import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname));

import config from "@/config.json";
import express from "express";
import cookieParser from "cookie-parser";
// import multer from "multer"; // Used in feature branch

import * as account from "@/routes/account";
import * as admin from "@/routes/admin";
import * as auth from "@/routes/auth";
import * as member from "@/routes/member";
import * as submission from "@/routes/submission";
import * as standings from "@/routes/standings";
import * as tank from "@/routes/tank";
import * as species from "@/routes/species";
import * as typeahead from "@/routes/typeahead";

import {
	getOutstandingSubmissionsCounts,
} from "./db/submissions";
import { getRecentActivity } from "./db/activity";

import { MulmRequest, sessionMiddleware } from "./sessions";
import { getGoogleOAuthURL } from "./oauth";
import { getQueryString } from "./utils/request";

const app = express();

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

app.use(express.static(path.join(__dirname, "../public")));

// Multer configuration for file uploads (used in feature branch)
// const upload = multer({
// 	storage: multer.memoryStorage(),
// 	limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
// });

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(cookieParser());
app.use(sessionMiddleware);

const router = express.Router();

router.get("/annual", (req, res) => {
	const year = getQueryString(req, 'year');
	res.set("HX-Redirect", `/annual/${year}`).send();
});
router.get("/annual/:stringYear{/:program}", standings.annual);
router.get("/lifetime{/:program}", standings.lifetime);

router.get("/", async (req: MulmRequest, res) => {
	const { viewer } = req;
	const isLoggedIn = Boolean(viewer);
	const isAdmin = viewer?.is_admin;

	const args = {
		title: "BAS BAP/HAP Portal",
		message: "Welcome to BAS!",
		googleURL: getGoogleOAuthURL(),
		isLoggedIn,
		isAdmin,
	};

	let approvalsProgram;
	let approvalsCount = 0;
	if (isAdmin) {
		const counts = await getOutstandingSubmissionsCounts();
		["coral", "plant", "fish"].forEach((program) => {
			const count = counts[program];
			if (count > 0) {
				approvalsProgram = program;
				approvalsCount += count;
			}
		});
	}

	// Get recent activity for the feed
	const recentActivity = await getRecentActivity(8);

	res.render("index", {
		...args,
		approvalsProgram,
		approvalsCount,
		recentActivity,
	});
});

// Entrypoint for BAP/HAP submission
router.get("/submit", submission.renderSubmissionForm);
router.get("/submit/addSupplement", (req, res) => {
	res.render("bapForm/supplementSingleLine");
});

router.get("/sub/:subId", submission.view);
router.post("/sub", submission.create);
router.patch("/sub/:subId", submission.update);
router.delete("/sub/:subId", submission.remove);

router.get("/tank", tank.view);
router.post("/tank", tank.create);
router.patch("/tank", tank.update);
router.delete("/tank/:name", tank.remove);

router.get("/sidebar/saveTank", tank.saveTankForm);
router.get("/sidebar/loadTank", tank.loadTankList);

router.get("/member/:memberId", member.view);

router.get("/me", (req: MulmRequest, res) => {
	const { viewer } = req;
	if (!viewer) {
		res.redirect("/");
		return;
	} else {
		res.redirect(`/member/${viewer.id}`);
		return;
	}
});

router.get("/species", species.explorer);
router.get("/species/:groupId", species.detail);

router.get("/account", account.viewAccountSettings);
router.patch("/account-settings", account.updateAccountSettings)
router.delete("/account/google/:sub", account.unlinkGoogleAccount);

// Admin Views /////////////////////////////////////////////////////

router.get("/admin/queue{/:program}", admin.requireAdmin, admin.showQueue);
router.post("/admin/approve", admin.requireAdmin, admin.approveSubmission);

router.get("/admin/edit{/:subId}", admin.requireAdmin, admin.viewEditSubmission);

router.get("/admin/members", admin.requireAdmin, admin.viewMembers);
router.get("/admin/members/:memberId/edit", admin.requireAdmin, admin.viewMemberUpdate)
router.get("/admin/members/:memberId/row", admin.requireAdmin, admin.viewMemberRow);
router.patch("/admin/members/:memberId", admin.requireAdmin, admin.updateMemberFields);
router.post("/admin/members/:memberId/check-levels", admin.requireAdmin, admin.checkMemberLevels);
router.post("/admin/members/:memberId/check-specialty-awards", admin.requireAdmin, admin.checkMemberSpecialtyAwards);

router.post("/admin/invite", admin.requireAdmin, admin.inviteMember);

router.get("/dialog/request-changes/:subId", admin.requireAdmin, admin.requestChangesForm);
router.post("/admin/request-changes/:subId", admin.requireAdmin, admin.sendRequestChanges);

// Password Auth ///////////////////////////////////////////

router.post("/signup", auth.signup);
router.post("/login", auth.passwordLogin);
router.get("/logout", auth.logout);
router.get("/forgot-password", auth.validateForgotPassword);
router.get("/set-password", auth.validateForgotPassword);
router.post("/forgot-password", auth.sendForgotPassword);
router.post("/reset-password", auth.resetPassword);

router.get("/dialog/signin", (req, res) => {
	res.render("account/signin", {
		viewer: {},
		errors: new Map(),
		googleURL: getGoogleOAuthURL(),
	});
});

router.get("/dialog/signup", (req, res) => {
	res.render("account/signup", {
		viewer: {},
		errors: new Map(),
	});
});

router.get("/dialog/forgot-password", (req, res) => {
	res.render("account/forgotPassword", {
		errors: new Map(),
	});
});

// OAuth ///////////////////////////////////////////////////

router.get("/oauth/google", auth.googleOAuth);

// API ///////////////////////////////////////////////////

router.get("/api/members/search", typeahead.searchMembers);
router.get("/api/species/search", typeahead.searchSpecies);

////////////////////////////////////////////////////////////

app.use(router);

const PORT = parseInt(process.env.PORT || "4200");
app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
	console.log(`Server running at https://${config.domain}`);
});
