export interface Secrets {
	databaseFile: string;
	domain: string;
	googleClientId: string;
	googleClientSecret: string;

	fromEmail: string;
	smtpPassword: string;
	smtpHost: string;
	smtpPort: string;
	smtpSecure: boolean;
}

