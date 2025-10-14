const isTest = process.env.NODE_ENV === "test";

export const logger = {
  error: (message: string, error?: unknown) => {
    if (!isTest) {
      console.error(`[ERROR] ${message}`, error);
    }
  },
  warn: (message: string, data?: unknown) => {
    if (!isTest) {
      console.warn(`[WARN] ${message}`, data);
    }
  },
  info: (message: string, data?: unknown) => {
    if (!isTest) {
      console.log(`[INFO] ${message}`, data);
    }
  },
};
