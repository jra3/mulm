// Type definition for config.json
declare module "@/config.json" {
  interface Config {
    database: {
      file: string;
    };
    server: {
      domain: string;
    };
    email: {
      disableEmails?: boolean;
      adminsEmail: string;
      bugReportEmail: string;
      fromEmail: string;
      smtp: {
        host: string;
        port: number;
        secure: boolean;
        password: string;
      };
    };
    oauth?: {
      google?: {
        clientId: string;
        clientSecret: string;
      };
      facebook?: {
        appId: string;
        appSecret: string;
      };
    };
    storage: {
      s3AccessKeyId: string;
      s3Secret: string;
      s3Url: string;
      s3Bucket: string;
      r2PublicUrl: string;
    };
    webauthn?: {
      rpName: string;
      rpID: string;
      origin: string;
    };
    iucn?: {
      apiToken: string;
      baseUrl: string;
      rateLimitMs: number;
      enableSync: boolean;
      maxRetries: number;
      timeoutMs: number;
    };
    fishbase?: {
      baseUrl: string;
      rateLimitMs: number;
      enableSync: boolean;
      maxRetries: number;
      timeoutMs: number;
      defaultLimit: number;
    };
    gbif?: {
      baseUrl: string;
      rateLimitMs: number;
      enableSync: boolean;
      maxRetries: number;
      timeoutMs: number;
    };
    wikipedia?: {
      baseUrl: string;
      rateLimitMs: number;
      enableSync: boolean;
      maxRetries: number;
      timeoutMs: number;
      wikidataUrl?: string;
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
