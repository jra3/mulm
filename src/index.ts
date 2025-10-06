import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname));

import config from "@/config.json";
import express from "express";
import cookieParser from "cookie-parser";
// import multer from "multer"; // Used in feature branch

import * as account from "@/routes/account";
import adminRouter from "@/routes/adminRouter";
import * as auth from "@/routes/auth";
import * as member from "@/routes/member";
import * as submission from "@/routes/submission";
import * as standings from "@/routes/standings";
import * as tank from "@/routes/tank";
import * as species from "@/routes/species";
import * as typeahead from "@/routes/typeahead";
import uploadRouter from "@/routes/api/upload";

import {
  getOutstandingSubmissionsCounts,
  getWitnessQueueCounts,
} from "./db/submissions";
import { getRecentActivity } from "./db/activity";

import { MulmRequest, sessionMiddleware } from "./sessions";
import { getGoogleOAuthURL } from "./oauth";
import { getQueryString } from "./utils/request";
import { initR2 } from "./utils/r2-client";

const app = express();

// Security: Hide Express version from X-Powered-By header
app.disable('x-powered-by');

// Initialize R2 client for image uploads
initR2();

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

// Make config available to all templates via res.locals
app.use((_req, res, next) => {
  res.locals.bugReportEmail = config.bugReportEmail;
  next();
});

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
  let witnessProgram;
  let witnessCount = 0;
  if (isAdmin) {
    const [counts, witnessCounts] = await Promise.all([
      getOutstandingSubmissionsCounts(),
      getWitnessQueueCounts(),
    ]);
    ["coral", "plant", "fish"].forEach((program) => {
      const count = counts[program];
      if (count > 0) {
        approvalsProgram = program;
        approvalsCount += count;
      }
      const witnessCountForProgram = witnessCounts[program];
      if (witnessCountForProgram > 0) {
        witnessProgram = program;
        witnessCount += witnessCountForProgram;
      }
    });
  }

  // Get recent activity for the feed
  const recentActivity = await getRecentActivity(8);

  res.render("index", {
    ...args,
    approvalsProgram,
    approvalsCount,
    witnessProgram,
    witnessCount,
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
router.get("/tank/save", tank.saveTankForm);
router.get("/tank/load", tank.loadTankList);
router.post("/tank", tank.create);
router.patch("/tank/:name", tank.update);
router.delete("/tank/:name", tank.remove);

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
router.patch("/account", account.updateAccountSettings)
router.delete("/account/google/:sub", account.unlinkGoogleAccount);

router.use("/admin", adminRouter);

// Password Auth ///////////////////////////////////////////

router.post("/signup", auth.signup);
router.post("/login", auth.passwordLogin);
router.get("/logout", auth.logout);
router.get("/forgot-password", auth.validateForgotPassword);
router.get("/set-password", auth.validateForgotPassword);
router.post("/forgot-password", auth.sendForgotPassword);
router.post("/reset-password", auth.resetPassword);

router.get("/dialog/auth/signin", (req, res) => {
  res.render("account/signin", {
    viewer: {},
    errors: new Map(),
    googleURL: getGoogleOAuthURL(),
  });
});

router.get("/dialog/auth/signup", (req, res) => {
  res.render("account/signup", {
    viewer: {},
    errors: new Map(),
  });
});

router.get("/dialog/auth/forgot-password", (req, res) => {
  res.render("account/forgotPassword", {
    errors: new Map(),
  });
});

// OAuth ///////////////////////////////////////////////////

router.get("/oauth/google", auth.googleOAuth);

// API ///////////////////////////////////////////////////

router.get("/api/members/search", typeahead.searchMembers);
router.get("/api/species/search", typeahead.searchSpecies);

// Image Upload API
router.use("/api/upload", uploadRouter);

////////////////////////////////////////////////////////////

// Health check endpoint for Docker and monitoring
app.get('/health', (_req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

app.use(router);

const PORT = parseInt(process.env.PORT || "4200");
const HOST = '0.0.0.0'; // Listen on all interfaces
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Server running at https://${config.domain}`);
});
