import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import {
  saveCredential,
  getCredentialById,
  getCredentialsByMember,
  updateCredentialCounter,
  saveChallenge,
  getChallenge,
} from "@/db/webauthn";
import configData from "@/config.json";

// Type the config properly
const config = configData as typeof configData & {
  webauthn: {
    rpName: string;
    rpID: string;
    origin: string;
  };
};

// WebAuthn configuration
const rpName = config.webauthn.rpName;
const rpID = config.webauthn.rpID;
const origin = config.webauthn.origin;

/**
 * Generate registration options for a logged-in member adding a passkey
 */
export async function generateRegistrationOptionsForMember(
  memberId: number,
  userEmail: string,
  userName: string
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  // Get existing credentials to exclude (prevent re-registering same authenticator)
  const existingCredentials = await getCredentialsByMember(memberId);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: userEmail,
    userDisplayName: userName,
    // Use member ID as user ID (stable identifier)
    userID: Buffer.from(String(memberId)),
    attestationType: "none", // We don't need attestation for this use case
    excludeCredentials: existingCredentials.map((cred) => ({
      id: cred.credential_id,
      transports: cred.transports
        ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
        : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred", // Discoverable credentials preferred
      userVerification: "preferred",
      authenticatorAttachment: "platform", // Prefer platform authenticators (Touch ID, Face ID)
    },
  });

  // Save challenge for verification
  await saveChallenge(options.challenge, "registration", memberId);

  return options;
}

/**
 * Verify registration response and save the credential
 */
export async function verifyAndSaveCredential(
  memberId: number,
  response: RegistrationResponseJSON,
  deviceName?: string
): Promise<{ verified: boolean; credentialId?: string }> {
  // Retrieve and validate challenge
  const clientDataJSON: string = Buffer.from(response.response.clientDataJSON, "base64").toString();
  const clientData = JSON.parse(clientDataJSON) as { challenge: string };
  const challengeData = await getChallenge(clientData.challenge);

  if (
    !challengeData ||
    challengeData.member_id !== memberId ||
    challengeData.purpose !== "registration"
  ) {
    return { verified: false };
  }

  // Verify the registration response
  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response: response,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch {
    return { verified: false };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false };
  }

  const { credential } = verification.registrationInfo;

  // Save credential to database
  const transportsStr: string | undefined = response.response.transports
    ? JSON.stringify(response.response.transports)
    : undefined;
  await saveCredential({
    member_id: memberId,
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey) as Buffer,
    counter: credential.counter,
    transports: transportsStr,
    device_name: deviceName,
  });

  return {
    verified: true,
    credentialId: credential.id,
  };
}

/**
 * Generate authentication options for passkey login
 */
export async function generateAuthenticationOptionsForLogin(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    // Don't specify allowCredentials - allow any registered passkey (discoverable)
  });

  // Save challenge for verification
  await saveChallenge(options.challenge, "authentication");

  return options;
}

/**
 * Verify authentication response and return member ID if successful
 */
export async function verifyCredentialAndAuthenticate(
  response: AuthenticationResponseJSON
): Promise<{ verified: boolean; memberId?: number }> {
  // Get credential from database
  const credentialIdBase64 = Buffer.from(response.id, "base64url").toString("base64url");
  const credential = await getCredentialById(credentialIdBase64);

  if (!credential) {
    return { verified: false };
  }

  // Retrieve and validate challenge
  const clientDataJSON: string = Buffer.from(response.response.clientDataJSON, "base64").toString();
  const clientData = JSON.parse(clientDataJSON) as { challenge: string };
  const challengeData = await getChallenge(clientData.challenge);

  if (!challengeData || challengeData.purpose !== "authentication") {
    return { verified: false };
  }

  // Verify the authentication response
  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response: response,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.credential_id,
        publicKey: credential.public_key,
        counter: credential.counter,
      },
    });
  } catch {
    return { verified: false };
  }

  if (!verification.verified) {
    return { verified: false };
  }

  // Update counter for replay attack prevention
  await updateCredentialCounter(
    credential.credential_id,
    verification.authenticationInfo.newCounter
  );

  return {
    verified: true,
    memberId: credential.member_id,
  };
}
