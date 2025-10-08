import {
  AuthCode,
  checkPassword,
  generateRandomCode,
  makePasswordEntry,
} from "@/auth";
import { createAuthCode, deleteAuthCode, getAuthCode } from "@/db/auth";
import {
  createGoogleAccount,
  createMember,
  createOrUpdatePassword,
  getGoogleAccount,
  getMember,
  getMemberByEmail,
  getMemberPassword,
} from "@/db/members";
import {
  forgotSchema,
  loginSchema,
  resetSchema,
  signupSchema,
} from "@/forms/login";
import { validateFormResult } from "@/forms/utils";
import { getBodyParam } from "@/utils/request";
import { sendResetEmail } from "@/notifications";
import { getGoogleUser, translateGoogleOAuthCode } from "@/oauth";
import { regenerateSession, destroyUserSession, MulmRequest } from "@/sessions";
import { Response } from "express";
import { logger } from "@/utils/logger";
import { recordFailedAttempt, isAccountLocked, clearFailedAttempts, getRemainingLockoutTime } from "@/services/accountLockout";

export const signup = async (req: MulmRequest, res: Response) => {
  const errors = new Map<string, string>();
  const onError = () => {
    res.render("account/signup", {
      viewer: {
        display_name: getBodyParam(req, "display_name"),
        contact_email: getBodyParam(req, "email"),
      },
      errors,
    });
  };

  const parsed = signupSchema.safeParse(req.body);
  if (!validateFormResult(parsed, errors, onError)) {
    return;
  }

  const body = parsed.data;
  try {
    const memberId = await createMember(body.email, body.display_name, {
      password: body.password,
    });
    await regenerateSession(req, res, memberId);
    res.set("HX-redirect", "/").send();
  } catch (e: unknown) {
    console.error(e);
    errors.set("form", "Failed to create new member account");
    onError();
  }
};

export const passwordLogin = async (req: MulmRequest, res: Response) => {
  const data = loginSchema.parse(req.body);

  // Always fetch member AND password to normalize timing
  const member = await getMemberByEmail(data.email);

  // Check if account is locked (before attempting password check)
  if (member && await isAccountLocked(member.id)) {
    const remainingSeconds = await getRemainingLockoutTime(member.id);
    const remainingMinutes = Math.ceil(remainingSeconds / 60);
    logger.warn('Login attempt on locked account', {
      memberId: member.id,
      ip: req.ip
    });
    res.status(403).send(
      `Account temporarily locked due to multiple failed login attempts. ` +
      `Please try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`
    );
    return;
  }

  const pass = member ? await getMemberPassword(member.id) : null;

  // Always call checkPassword even if member doesn't exist (timing attack mitigation)
  // Use dummy password entry if member not found
  const isValid = await checkPassword(
    pass ?? {
      N: 16384,
      r: 8,
      p: 1,
      salt: "dGltaW5nQXR0YWNrTWl0aWdhdGlvblNhbHQxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY=", // Base64 dummy
      hash: "dGltaW5nQXR0YWNrTWl0aWdhdGlvbkhhc2gxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY=" // Base64 dummy
    },
    data.password
  );

  if (member && isValid) {
    // Successful login - clear failed attempts
    await clearFailedAttempts(member.id);
    await regenerateSession(req, res, member.id);
    res.set("HX-Redirect", "/").send();
    return;
  }

  // Failed login - record attempt if member exists
  if (member) {
    const locked = await recordFailedAttempt(member.id, req.ip || 'unknown');
    if (locked) {
      const remainingMinutes = 15; // Lockout duration
      logger.warn('Account locked after failed attempts', {
        memberId: member.id,
        ip: req.ip
      });
      res.status(403).send(
        `Account locked due to too many failed login attempts. ` +
        `Please wait ${remainingMinutes} minutes or reset your password.`
      );
      return;
    }
  }

  // Generic error message (no distinction between invalid email vs password)
  res.send("Incorrect email or password");
};

// Clears the session cookies and deletes the session from the db
export const logout = async (req: MulmRequest, res: Response) => {
  await destroyUserSession(req, res);
  // HTMX uses HX-Redirect header, but we need to send a response
  res.set("HX-Redirect", "/").send();
};

export const validateForgotPassword = async (
  req: MulmRequest,
  res: Response,
) => {
  const code = req.query.code;
  if (code == undefined) {
    res.redirect("/");
    return;
  }

  const now = new Date(Date.now());
  const codeEntry = await getAuthCode(code as string);
  const invalidCode =
    codeEntry == undefined ||
    codeEntry.purpose != "password_reset" ||
    codeEntry.expires_on < now;
  const member = codeEntry && (await getMember(codeEntry.member_id));

  if (invalidCode || !member) {
    res.render("account/resetPasswordError", {
      errors: new Map<string, string>(),
    });
  } else {
    res.render("account/resetPassword", {
      invalidCode,
      email: member.contact_email,
      code: code,
      errors: new Map<string, string>(),
    });
  }
};

export const sendForgotPassword = async (req: MulmRequest, res: Response) => {
  const errors = new Map<string, string>();
  const renderDialog = () => {
    res.render("account/forgotPassword", {
      ...(req.body as object),
      errors,
    });
  };

  const parsed = forgotSchema.safeParse(req.body);
  if (!validateFormResult(parsed, errors, renderDialog)) {
    return;
  }

  const member = await getMemberByEmail(parsed.data.email);

  // Always create auth code structure (timing attack mitigation)
  const code: AuthCode = {
    member_id: member?.id ?? 0,
    code: generateRandomCode(24),
    expires_on: new Date(Date.now() + 60 * 60 * 1000),
    purpose: "password_reset",
  };

  if (member) {
    // Actually save code and send email
    await Promise.all([
      createAuthCode(code),
      sendResetEmail(member.contact_email, member.display_name, code.code)
    ]);
  } else {
    // Simulate same operations for timing (300ms ~ DB write + email send)
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // Always show success message (prevents email enumeration)
  errors.set("success", "Check your email for a reset link.");
  renderDialog();
};

export const resetPassword = async (req: MulmRequest, res: Response) => {
  const errors = new Map<string, string>();

  const renderPage = () => {
    res.render("account/resetPassword", {
      errors,
    });
  };

  const parsed = resetSchema.safeParse(req.body);
  if (!validateFormResult(parsed, errors, renderPage)) {
    return;
  }

  const now = new Date(Date.now());
  const codeEntry = await getAuthCode(parsed.data.code);
  if (codeEntry == undefined || codeEntry.purpose != "password_reset") {
    errors.set("form", "Invalid code");
  } else if (codeEntry.expires_on < now) {
    errors.set("form", "Code expired");
  } else {
    const member = await getMember(codeEntry.member_id);
    if (member == undefined) {
      errors.set("form", "Member not found");
    } else {
      try {
        const passwordEntry = await makePasswordEntry(parsed.data.password);
        await Promise.all([
          deleteAuthCode(codeEntry.code),
          createOrUpdatePassword(member.id, passwordEntry),
        ]);
        await regenerateSession(req, res, member.id);
        res.set("HX-redirect", "/").send();
        return;
      } catch (e: unknown) {
        console.error(e);
        errors.set("form", "Failed to reset password");
      }
    }
  }

  renderPage();
};

// OAuth

export const googleOAuth = async (req: MulmRequest, res: Response) => {
  const { code, state } = req.query;

  // Validate state parameter for CSRF protection
  if (!state || typeof state !== 'string') {
    logger.warn('Missing OAuth state parameter');
    res.status(400).send("Invalid OAuth request. Please try logging in again.");
    return;
  }

  // Validate state parameter using cookie (works for both anonymous and logged-in users)
  const storedState = String(req.cookies.oauth_state);

  if (!storedState || storedState !== state) {
    logger.warn('Invalid OAuth state parameter', {
      storedState: storedState?.substring(0, 10) + '...',
      receivedState: state?.substring(0, 10) + '...'
    });
    res.status(403).send("Invalid OAuth state. This may be a CSRF attack. Please try logging in again.");
    return;
  }

  // Clear the state cookie (one-time use)
  res.clearCookie('oauth_state');

  const resp = await translateGoogleOAuthCode(code as string);
  const payload: unknown = await resp.json();

  // Type narrowing with runtime checks
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("access_token" in payload)
  ) {
    console.error(payload);
    res.status(401).send("Login Failed!");
    return;
  }

  const tokenPayload = payload as { access_token: unknown };
  const token = String(tokenPayload.access_token);
  const googleUser = await getGoogleUser(token);
  const record = await getGoogleAccount(googleUser.sub);

  let memberId: number | undefined = undefined;

  if (!record) {
    // We've never seen this google sub before!
    const { viewer } = req;
    if (viewer) {
      // if we are already logged in, we should link to the current member
      memberId = viewer.id;
    } else {
      // We are not logged in, check if we can link to an existing member
      const member = await getMemberByEmail(googleUser.email);
      if (member) {
        // We found a member using the same email as this google account. link it.
        memberId = member.id;
      } else {
        // We need to create a new member and a new google account
        memberId = await createMember(googleUser.email, googleUser.name);
      }
    }

    await createGoogleAccount(memberId, googleUser.sub, googleUser.email);
  } else {
    memberId = record.member_id;
  }

  if (memberId == undefined) {
    res.status(401).send();
    return;
  }

  await regenerateSession(req, res, memberId);
  res.redirect("/");
};
