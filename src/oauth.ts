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

export async function getGoogleUser(accessToken: string): Promise<{name: string, email: string}> {
	const resp = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`)
	if (!resp.ok) {
		throw new Error("Failed to fetch user from Google");
	}
	const respBody = await resp.json();
	if (respBody.name == null || respBody.email == null) {
		throw new Error("Failed to fetch user from Google");
	}

	return {
		name: String(respBody.name),
		email: String(respBody.email),
	};
}
