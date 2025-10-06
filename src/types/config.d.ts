export interface Config {
  databaseFile: string;
  domain: string;
  googleClientId: string;
  googleClientSecret: string;
  adminsEmail: string;
  bugReportEmail: string;
  fromEmail: string;
  smtpPassword: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  s3AccessKeyId: string;
  s3Secret: string;
  s3Url: string;
  s3Bucket: string;
  r2PublicUrl: string;
}

declare module "@/config.json" {
  const config: Config;
  export default config;
}
