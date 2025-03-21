import config from './config.json';

export function getGoogleOAuthURL(): string {
	const endpoint = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	endpoint.searchParams.append("access_type", "offline");
	endpoint.searchParams.append("client_id", config.googleClientId);
	endpoint.searchParams.append("redirect_uri", `https://${config.domain}/oauth/google`);
	endpoint.searchParams.append("scope", "openid");
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
