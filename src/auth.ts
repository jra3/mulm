import { randomBytes, scrypt } from "node:crypto";

const kKeyLen = 32;

type AuthCodePurpose = "email_verification" | "password_reset";
export type AuthCode = {
	code: string;
	member_id: number;
	purpose: AuthCodePurpose;
	expires_on: Date;
};

export type ScryptPassword = {
	N: number;
	r: number;
	p: number;
	salt: string;
	hash: string;
};

/**
 * Provides an adapter to convert node-style callbacks into promises. The behavior is a little more
 * explicit than `util.promisify`.
 */
function withNodeCallback<Type = void>(
	fn: (
		callback: (error: Error | null | undefined, result: Type) => void,
	) => void,
): Promise<Type> {
	return new Promise<Type>((resolve, reject) => {
		fn((error, result) => {
			if (error) {
				reject(error);
			} else {
				resolve(result);
			}
		});
	});
}

export async function makePasswordEntry(
	password: string,
): Promise<ScryptPassword> {
	const salt = randomBytes(16);
	const scryptOptions = {
		N: 16384,
		r: 8,
		p: 1,
	};
	const hash = await withNodeCallback<Buffer>((callback) =>
		scrypt(password, salt, kKeyLen, scryptOptions, callback),
	);
	const passwordEntry: ScryptPassword = {
		...scryptOptions,
		salt: salt.toString("base64"),
		hash: hash.toString("base64"),
	};
	return passwordEntry;
}

/**
 * Check that the supplied password matches the hashed password stored in an `Account` item.
 * Returns `true` if the hashed password matches the cleartext password.
 */
export async function checkPassword(
	passwordEntry: ScryptPassword | undefined,
	clearPassword: string,
) {
	if (passwordEntry === undefined) {
		return false;
	}

	const result = await withNodeCallback<Buffer>((callback) =>
		scrypt(
			clearPassword,
			Buffer.from(passwordEntry.salt, "base64"),
			kKeyLen,
			{
				N: passwordEntry.N,
				r: passwordEntry.r,
				p: passwordEntry.p,
			},
			callback,
		),
	);
	return result.toString("base64") === passwordEntry.hash;
}

export function generateRandomCode(length = 64) {
	const bytes = randomBytes(length);
	return bytes.toString("base64url");
}
