import { query, insertOne, updateOne, deleteOne, writeConn } from "./conn";

export type WebAuthnCredential = {
  id: number;
  member_id: number;
  credential_id: string;
  public_key: Buffer;
  counter: number;
  transports: string | null;
  device_name: string | null;
  created_on: string;
  last_used_on: string | null;
};

export type WebAuthnChallenge = {
  challenge: string;
  member_id: number | null;
  purpose: 'registration' | 'authentication';
  expires_on: string;
  created_on: string;
};

// ==================== Credential Management ====================

/**
 * Save a new WebAuthn credential for a member
 */
export async function saveCredential(data: {
  member_id: number;
  credential_id: string;
  public_key: Buffer;
  counter: number;
  transports?: string;
  device_name?: string;
}): Promise<number> {
  const conn = writeConn;
  const stmt = await conn.prepare(`
    INSERT INTO webauthn_credentials (
      member_id, credential_id, public_key, counter, transports, device_name
    ) VALUES (?, ?, ?, ?, ?, ?)
    RETURNING id
  `);

  try {
    const result = await stmt.get<{ id: number }>(
      data.member_id,
      data.credential_id,
      data.public_key,
      data.counter,
      data.transports || null,
      data.device_name || null
    );

    if (!result) {
      throw new Error('Failed to insert credential');
    }

    return result.id;
  } finally {
    await stmt.finalize();
  }
}

/**
 * Get credential by credential ID (for authentication)
 */
export async function getCredentialById(credentialId: string): Promise<WebAuthnCredential | null> {
  const rows = await query<WebAuthnCredential>(
    'SELECT * FROM webauthn_credentials WHERE credential_id = ?',
    [credentialId]
  );
  return rows[0] || null;
}

/**
 * Get all credentials for a member (for account management)
 */
export async function getCredentialsByMember(memberId: number): Promise<WebAuthnCredential[]> {
  return query<WebAuthnCredential>(
    'SELECT * FROM webauthn_credentials WHERE member_id = ? ORDER BY created_on DESC',
    [memberId]
  );
}

/**
 * Update credential counter (for replay attack prevention)
 */
export async function updateCredentialCounter(credentialId: string, newCounter: number): Promise<void> {
  await updateOne('webauthn_credentials', { credential_id: credentialId }, {
    counter: newCounter,
    last_used_on: new Date().toISOString()
  });
}

/**
 * Update device name for a credential
 */
export async function updateCredentialDeviceName(id: number, deviceName: string): Promise<void> {
  await updateOne('webauthn_credentials', { id }, { device_name: deviceName });
}

/**
 * Delete a credential by ID
 */
export async function deleteCredential(id: number): Promise<void> {
  await deleteOne('webauthn_credentials', { id });
}

// ==================== Challenge Management ====================

/**
 * Save a challenge for registration or authentication
 */
export async function saveChallenge(
  challenge: string,
  purpose: 'registration' | 'authentication',
  memberId?: number
): Promise<void> {
  const expiresOn = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  await insertOne('webauthn_challenges', {
    challenge,
    member_id: memberId || null,
    purpose,
    expires_on: expiresOn.toISOString()
  });
}

/**
 * Get and validate a challenge (single-use)
 */
export async function getChallenge(challenge: string): Promise<WebAuthnChallenge | null> {
  const rows = await query<WebAuthnChallenge>(
    'SELECT * FROM webauthn_challenges WHERE challenge = ? AND expires_on > datetime("now")',
    [challenge]
  );

  const challengeData = rows[0] || null;

  // Delete challenge after retrieval (single-use)
  if (challengeData) {
    await deleteOne('webauthn_challenges', { challenge });
  }

  return challengeData;
}

/**
 * Delete expired challenges (cleanup task)
 */
export async function deleteExpiredChallenges(): Promise<number> {
  const conn = writeConn;
  const stmt = await conn.prepare(
    'DELETE FROM webauthn_challenges WHERE expires_on <= datetime("now")'
  );

  try {
    const result = await stmt.run();
    return result.changes || 0;
  } finally {
    await stmt.finalize();
  }
}
