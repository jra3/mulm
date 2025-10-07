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
import { createUserSession, destroyUserSession, MulmRequest } from "@/sessions";
import { Response } from "express";
import { logger } from "@/utils/logger";

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
    await createUserSession(req, res, memberId);
    res.set("HX-redirect", "/").send();
  } catch (e: unknown) {
    console.error(e);
    errors.set("form", "Failed to create new member account");
    onError();
  }
};

export const passwordLogin = async (req: MulmRequest, res: Response) => {
  const data = loginSchema.parse(req.body);
  const member = await getMemberByEmail(data.email);
  if (member != undefined) {
    const pass = await getMemberPassword(member.id);
    if (await checkPassword(pass, data.password)) {
      await createUserSession(req, res, member.id);
      res.set("HX-Redirect", "/").send();
      return;
    }
  }
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
  if (member == undefined) {
    // should fake success to prevent email enumeration
    errors.set("success", "Check your email for a reset link.");
    renderDialog();
    return;
  }

  const code: AuthCode = {
    member_id: member.id,
    code: generateRandomCode(24),
    expires_on: new Date(Date.now() + 60 * 60 * 1000),
    purpose: "password_reset",
  };
  await createAuthCode(code);
  await sendResetEmail(member.contact_email, member.display_name, code.code);
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
        await createUserSession(req, res, member.id);
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

  const sessionId = String(req.cookies.session_id);
  if (!sessionId) {
    logger.warn('Missing session ID during OAuth callback');
    res.status(400).send("Session expired. Please try logging in again.");
    return;
  }

  const { validateAndConsumeOAuthState } = await import('../sessions');
  const isValidState = await validateAndConsumeOAuthState(sessionId, state);

  if (!isValidState) {
    logger.warn('Invalid OAuth state parameter', { sessionId, receivedState: state });
    res.status(403).send("Invalid OAuth state. This may be a CSRF attack. Please try logging in again.");
    return;
  }

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

  await createUserSession(req, res, memberId);
  res.redirect("/");
};
