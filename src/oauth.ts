import config from './config.json';

export function getGoogleOAuthURL(): string {
	const endpoint = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	endpoint.searchParams.append("access_type", "offline");
	endpoint.searchParams.append("client_id", config.googleClientId);
	endpoint.searchParams.append("redirect_uri", `https://${config.domain}/oauth/google`);
	endpoint.searchParams.append("scope", "email profile");
	endpoint.searchParams.append("response_type", "code");
	return String(endpoint);
}

/**
 * https://developers.google.com/youtube/reporting/guides/authorization/server-side-web-apps#exchange-authorization-code
 */
export async function translateGoogleOAuthCode(code: string) {
	const endpoint = new URL("https://oauth2.googleapis.com/token");
	const body = new URLSearchParams({
		client_id: config.googleClientId,
		client_secret: config.googleClientSecret,
		grant_type: "authorization_code",
		redirect_uri: `https://${config.domain}/oauth/google`,
		code,
	});
	return fetch(endpoint, { body, method: "POST" });
}

export async function getGoogleUser(accessToken: string): Promise<{sub: string, name: string, email: string}> {
	const resp = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`)
	if (!resp.ok) {
		throw new Error("Failed to fetch user from Google");
	}
	const respBody: unknown = await resp.json();
	
	if (
		typeof respBody !== 'object' || 
		respBody === null ||
		!('name' in respBody) ||
		!('email' in respBody) ||
		!('sub' in respBody)
	) {
		throw new Error("Failed to fetch user from Google");
	}

	const googleUser = respBody as { sub: string, name: string, email: string };
	
	if (googleUser.name == null || googleUser.email == null) {
		throw new Error("Failed to fetch user from Google");
	}

	return {
		sub: String(googleUser.sub),
		name: String(googleUser.name),
		email: String(googleUser.email),
	};
}
