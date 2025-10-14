import { checkPassword, makePasswordEntry } from "@/auth";
import { getMemberPassword, createOrUpdatePassword, updateMember, getGoogleAccountByMemberId, deleteGoogleAccount } from "@/db/members";
import { updateSchema } from "@/forms/login";
import { getGoogleOAuthURL, setOAuthStateCookie } from "@/oauth";
import { MulmRequest } from "@/sessions";
import { Response } from "express";
import { logger } from "@/utils/logger";
import { queryTankPresets, createTankPreset, updateTankPreset, deleteTankPreset } from "@/db/tank";
import { tankSettingsSchema } from "@/forms/tank";
import { validateFormResult } from "@/forms/utils";
import pug from "pug";
import { getBodyString } from "@/utils/request";
import { getCredentialsByMember } from "@/db/webauthn";

export const viewAccountSettings = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send();
    return;
  }

  // Generate OAuth state for CSRF protection (stored in cookie)
  const oauthState = setOAuthStateCookie(res);

  const [
    googleURL,
    googleAccount,
    presets,
    credentials
  ] = await Promise.all([
    Promise.resolve(getGoogleOAuthURL(oauthState)),
    getGoogleAccountByMemberId(viewer.id),
    queryTankPresets(viewer.id),
    getCredentialsByMember(viewer.id),
  ]);

  res.render("account/page", {
    title: "Account Settings",
    viewer,
    googleURL,
    googleAccount,
    presets,
    credentials,
    errors: new Map(),
  });
};

export const updateAccountSettings = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send();
    return;
  }

  const errors = new Map<string, string>();
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    parsed.error.issues.forEach((issue) => {
      errors.set(String(issue.path[0]), issue.message);
    });

    res.render("account/settings", {
      viewer,
      errors,
    });
    return;
  }

  const form = parsed.data;

  try {
    if (form.current_password && form.password) {
      const currentPasswordEntry = await getMemberPassword(viewer.id);
      // Not set, or we have correct password
      // Need better logic here...
      if (!currentPasswordEntry || await checkPassword(currentPasswordEntry, form.current_password)) {
        const passwordEntry = await makePasswordEntry(form.password)
        await createOrUpdatePassword(viewer.id, passwordEntry)
        // Updated password!
      } else {
        errors.set("password", "Password incorrect");
      }
    }
  } catch (e: unknown) {
    logger.error("Failed to update password", e);
    errors.set("password", "Unknown error");
  }

  await updateMember(viewer.id, {
    display_name: form.display_name,
    contact_email: form.email,
  });

  res.render("account/settings", {
    viewer: {
      display_name: form.display_name,
      contact_email: form.email,
    },
    errors,
  });
}

export const unlinkGoogleAccount = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send();
    return;
  }

  const googleAccount = await getGoogleAccountByMemberId(viewer.id);
  if (!googleAccount) {
    res.status(404).send("No Google account linked");
    return;
  }

  await deleteGoogleAccount(googleAccount.google_sub, viewer.id);
  res.send("Unlinked Google account");
}

// Tank Preset Management Routes

// No longer needed - form is always in DOM

export const viewTankPresetCard = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send();
    return;
  }

  // RESTful GET - preset name from URL parameter
  const presetName = decodeURIComponent(req.params.name);
  const presets = await queryTankPresets(viewer.id);
  const preset = presets.find(p => p.preset_name === presetName);

  if (!preset) {
    res.status(404).send("Preset not found");
    return;
  }

  res.render("account/tankPresetCard", {
    preset
  });
};

export const editTankPresetForm = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send();
    return;
  }

  // RESTful GET - preset name from URL parameter
  const presetName = decodeURIComponent(req.params.name);
  const presets = await queryTankPresets(viewer.id);
  const preset = presets.find(p => p.preset_name === presetName);

  if (!preset) {
    res.status(404).send("Preset not found");
    return;
  }

  res.render("account/tankPresetForm", {
    preset,
    editing: true,
    errors: new Map()
  });
};

export const saveTankPresetRoute = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send();
    return;
  }

  const isEditing = getBodyString(req, 'editing') === 'true';
  const errors = new Map<string, string>();
  const parsed = tankSettingsSchema.safeParse(req.body);

  if (!validateFormResult(parsed, errors, () => {
    res.render("account/tankPresetForm", {
      preset: req.body as Record<string, unknown>,
      editing: isEditing,
      errors
    });
  })) {
    return;
  }

  try {
    if (isEditing) {
      await updateTankPreset({
        ...parsed.data,
        member_id: viewer.id,
      });
    } else {
      await createTankPreset({
        ...parsed.data,
        member_id: viewer.id,
      });
    }

    // Return the preset card (new or updated)
    const presets = await queryTankPresets(viewer.id);
    const preset = presets.find(p => p.preset_name === parsed.data.preset_name);

    if (isEditing) {
      res.render("account/tankPresetCard", {
        preset
      });
    } else {
      // For new presets, return card + hide form + reset form using out-of-band
      const cardHtml = pug.renderFile("src/views/account/tankPresetCard.pug", { preset });
      const formHtml = pug.renderFile("src/views/account/tankPresetForm.pug", {
        preset: {},
        editing: false,
        errors: new Map()
      });
      res.send(`${cardHtml}<div id="newPresetForm" class="hidden" hx-swap-oob="outerHTML">${formHtml}</div>`.trim());
    }
  } catch (err) {
    logger.error('Failed to save tank preset', err);
    errors.set('preset_name', isEditing ? 'Failed to update preset' : 'A preset with this name already exists');

    // Retarget for create, normal target for edit
    if (!isEditing) {
      res.set('HX-Retarget', '#newPresetForm');
      res.set('HX-Reswap', 'outerHTML');
    }

    res.render("account/tankPresetForm", {
      preset: req.body as Record<string, unknown>,
      editing: isEditing,
      errors
    });
  }
};

export const deleteTankPresetRoute = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send();
    return;
  }

  // RESTful DELETE - preset name from URL parameter
  const presetName = decodeURIComponent(req.params.name);

  try {
    await deleteTankPreset(viewer.id, presetName);
    res.status(200).send(); // Empty response causes HTMX to remove the element
  } catch (err) {
    logger.error('Failed to delete tank preset', err);
    res.status(500).send('Failed to delete preset');
  }
};

