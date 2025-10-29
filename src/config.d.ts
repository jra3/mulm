// Type definition for config.json
declare module "@/config.json" {
  interface Config {
    databaseFile: string;
    domain: string;
    disableEmails?: boolean;
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
    iucn?: {
      apiToken: string;
      baseUrl: string;
      rateLimitMs: number;
      enableSync: boolean;
      maxRetries: number;
      timeoutMs: number;
    };
    mcp?: {
      enabled: boolean;
      port: number;
      host: string;
    };
  }

  const config: Config;
  export default config;
}

declare module "./config.json" {
  import type config from "@/config.json";
  export default config;
}

declare module "../config.json" {
  import type config from "@/config.json";
  export default config;
}
