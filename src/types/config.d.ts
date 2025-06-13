export interface Config {
  databaseFile: string;
  domain: string;
  googleClientId: string;
  googleClientSecret: string;
  resendApiKey: string;
  adminsEmail: string;
  fromEmail: string;
  smtpPassword: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  s3AccessKeyId: string;
  s3Secret: string;
  s3Url: string;
}

declare module "@/config.json" {
  const config: Config;
  export default config;
}
