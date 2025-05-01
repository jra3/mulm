import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname));

import config from "@/config.json";
import express from "express";
import cookieParser from "cookie-parser";

import * as account from "@/routes/account";
import * as auth from "@/routes/auth";
import * as member from "@/routes/member";
import * as admin from "@/routes/admin";
import * as submission from "@/routes/submission";
import * as standings from "@/routes/standings";

import {
	getOutstandingSubmissionsCounts,
} from "./db/submissions";

import { MulmRequest, sessionMiddleware } from "./sessions";
import { getGoogleOAuthURL } from "./oauth";

const app = express();

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

app.use(express.static(path.join(__dirname, "../public")));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(cookieParser());
app.use(sessionMiddleware);

const router = express.Router();

router.get("/annual", async (req, res) => {
	const { year } = req.query;
	res.set("HX-Redirect", `/annual/${String(year)}`).send();
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
		googleURL: await getGoogleOAuthURL(),
		isLoggedIn,
		isAdmin,
	};

	let approvalsProgram;
	let approvalsCount = 0;
	if (isAdmin) {
		const counts = getOutstandingSubmissionsCounts();
		Object.entries(counts).forEach(([program, count]) => {
			if (count > 0) {
				approvalsProgram = program;
				approvalsCount += count;
			}
		});
	}

	res.render("index", {
		...args,
		approvalsProgram,
		approvalsCount,
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

router.get("/member/:memberId", member.view);

router.get("/me", async (req: MulmRequest, res) => {
	const { viewer } = req;
	if (!viewer) {
		res.redirect("/");
		return;
	} else {
		res.redirect(`/member/${viewer.id}`);
		return;
	}
});

router.get("/account", account.viewAccountSettings);
router.patch("/account-settings", account.updateAccountSettings)

// Admin Views /////////////////////////////////////////////////////

router.get("/admin/queue{/:program}", admin.requireAdmin, admin.showQueue);
router.post("/admin/approve", admin.requireAdmin, admin.approveSubmission);

router.get("/admin/members", admin.requireAdmin, admin.viewMembers);
router.get("/admin/members/edit/:memberId", admin.requireAdmin, admin.viewMemberUpdate)
router.patch("/admin/members/edit/:memberId", admin.requireAdmin, admin.updateMemberFields);

// Password Auth ///////////////////////////////////////////

router.post("/signup", auth.signup);
router.post("/login", auth.passwordLogin);
router.get("/logout", auth.logout);
router.get("/forgot-password", auth.validateForgotPassword);
router.post("/forgot-password", auth.sendForgotPassword);
router.post("/reset-password", auth.resetPassword);

router.get("/dialog/signin", async (req, res) => {
	res.render("account/signin", {
		viewer: {},
		errors: new Map(),
		googleURL: await getGoogleOAuthURL(),
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

////////////////////////////////////////////////////////////

app.use(router);

const PORT = process.env.PORT || 4200;
app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
	console.log(`Server running at https://${config.domain}`);
});
