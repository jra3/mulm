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
import displayRouter from "@/routes/display";
import * as member from "@/routes/member";
import * as submission from "@/routes/submission";
import * as standings from "@/routes/standings";
import * as tank from "@/routes/tank";
import * as species from "@/routes/species";
import * as typeahead from "@/routes/typeahead";
import uploadRouter from "@/routes/api/upload";

import { getOutstandingSubmissionsCounts, getWitnessQueueCounts } from "./db/submissions";
import { getRecentActivity } from "./db/activity";

import { MulmRequest, sessionMiddleware } from "./sessions";
import { getGoogleOAuthURL, setOAuthStateCookie } from "./oauth";
import { getQueryString } from "./utils/request";
import { initR2 } from "./utils/r2-client";
import {
  loginRateLimiter,
  signupRateLimiter,
  forgotPasswordRateLimiter,
  oauthRateLimiter,
} from "./middleware/rateLimiter";
import * as emailDemo from "./routes/emailDemo";
import { startScheduledCleanup } from "./scheduled/cleanup";

const app = express();

// Security: Hide Express version from X-Powered-By header
app.disable("x-powered-by");

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
  res.locals.domain = config.domain;
  next();
});

const router = express.Router();

router.get("/annual", (req, res) => {
  const year = getQueryString(req, "year");
  res.set("HX-Redirect", `/annual/${year}`).send();
});
router.get("/annual/:stringYear{/:program}", standings.annual);
router.get("/lifetime{/:program}", standings.lifetime);

router.get("/", async (req: MulmRequest, res) => {
  const { viewer } = req;
  const isLoggedIn = Boolean(viewer);
  const isAdmin = viewer?.is_admin;

  // Generate OAuth state for CSRF protection (stored in cookie)
  const oauthState = setOAuthStateCookie(res);

  const args = {
    title: "BAS BAP/HAP Portal",
    message: "Welcome to BAS!",
    googleURL: getGoogleOAuthURL(oauthState),
    isLoggedIn,
    isAdmin,
  };

  let approvalsProgram = "fish"; // Default to fish
  let approvalsCount = 0;
  let witnessProgram = "fish"; // Default to fish
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

// Submission routes (BAP/HAP/CAP)
router.get("/submissions/new", submission.renderSubmissionForm);
router.get("/submissions/new/addSupplement", (req, res) => {
  res.render("bapForm/supplementSingleLine");
});
router.get("/submissions/:id", submission.view);
router.post("/submissions", submission.create);
router.patch("/submissions/:id", submission.update);
router.delete("/submissions/:id", submission.remove);

// Tank form component (used in BAP submissions)
router.get("/tank", tank.view);

// Tank preset management (RESTful CRUD)
router.get("/tanks", tank.loadTankList);
router.get("/tanks/new", tank.saveTankForm);
router.post("/tanks", tank.create);
router.patch("/tanks/:name", tank.update);
router.delete("/tanks/:name", tank.remove);

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

// Demo routes (dev/admin only)
router.get("/demo/emails", emailDemo.emailDemoPage);
router.get("/species/:groupId", species.detail);

router.get("/account", account.viewAccountSettings);
router.patch("/account", account.updateAccountSettings);
router.delete("/account/google", account.unlinkGoogleAccount);

// Account tank preset management (RESTful routes)
router.post("/account/tanks", account.saveTankPresetRoute);
router.get("/account/tanks/:name/edit", account.editTankPresetForm);
router.get("/account/tanks/:name", account.viewTankPresetCard);
router.delete("/account/tanks/:name", account.deleteTankPresetRoute);

router.use("/admin", adminRouter);

// Display screen for club meetings (public, no auth required)
router.use("/", displayRouter);

// Auth routes ///////////////////////////////////////////

router.post("/auth/signup", signupRateLimiter, auth.signup);
router.post("/auth/login", loginRateLimiter, auth.passwordLogin);
router.post("/auth/logout", auth.logout);
router.get("/auth/forgot-password", auth.validateForgotPassword);
router.get("/auth/set-password", auth.validateForgotPassword);
router.post("/auth/forgot-password", forgotPasswordRateLimiter, auth.sendForgotPassword);
router.post("/auth/reset-password", auth.resetPassword);

// Passkey (WebAuthn) authentication
router.post("/auth/passkey/register/options", auth.passkeyRegisterOptions);
router.post("/auth/passkey/register/verify", auth.passkeyRegisterVerify);
router.post("/auth/passkey/login/options", loginRateLimiter, auth.passkeyLoginOptions);
router.post("/auth/passkey/login/verify", loginRateLimiter, auth.passkeyLoginVerify);
router.delete("/auth/passkey/:id", auth.deletePasskey);
router.patch("/auth/passkey/:id/name", auth.renamePasskey);

// OAuth (external dependency - redirect_uri registered with Google)
router.get("/oauth/google", oauthRateLimiter, auth.googleOAuth);

router.get("/dialog/auth/signin", (req, res) => {
  // Generate OAuth state for CSRF protection (stored in cookie)
  const oauthState = setOAuthStateCookie(res);

  res.render("account/signin", {
    viewer: {},
    errors: new Map(),
    googleURL: getGoogleOAuthURL(oauthState),
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

// API ///////////////////////////////////////////////////

router.get("/api/members/search", typeahead.searchMembers);
router.get("/api/species/search", typeahead.searchSpecies);
router.get("/api/video/preview", submission.videoPreview);

// Image Upload API
router.use("/api/upload", uploadRouter);

////////////////////////////////////////////////////////////

// Health check endpoint for Docker and monitoring
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.use(router);

const PORT = parseInt(process.env.PORT || "4200");
const HOST = "0.0.0.0"; // Listen on all interfaces
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Server running at https://${config.domain}`);

  // Start scheduled cleanup tasks (runs daily at 3 AM)
  startScheduledCleanup();
});
