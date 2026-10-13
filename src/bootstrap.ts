import type { Express } from "express";
import type { Server } from "node:http";
import { createApp, type AppDependencies } from "./app";
import { ensureReady, closeConnections } from "./db/conn";
import { initR2, closeR2 } from "./utils/r2-client";
import { startMcpHttpServer, stopMcpHttpServer } from "./mcp/http-server";
import { startScheduledCleanup, stopScheduledCleanup } from "./scheduled/cleanup";
import {
  startFinalSubmissionReminders,
  stopFinalSubmissionReminders,
} from "./scheduled/finalSubmissionReminder";
import { startCommitteeDigest, stopCommitteeDigest } from "./scheduled/committeeDigest";
import { isLiveProduction } from "./utils/environment";

type Stop = () => void | Promise<void>;
export interface StartupService {
  start: () => void | Promise<void>;
  stop: Stop;
}

/** Only process-owned effects are replaceable; routes use the real repositories. */
export interface BootstrapEffects {
  database: StartupService;
  storage: StartupService;
  mcp: StartupService;
  jobs: StartupService[];
}
const productionEffects: BootstrapEffects = {
  database: { start: ensureReady, stop: closeConnections },
  storage: {
    start: () => {
      initR2();
    },
    stop: closeR2,
  },
  mcp: { start: startMcpHttpServer, stop: stopMcpHttpServer },
  jobs: [
    { start: startScheduledCleanup, stop: stopScheduledCleanup },
    { start: startFinalSubmissionReminders, stop: stopFinalSubmissionReminders },
    { start: startCommitteeDigest, stop: stopCommitteeDigest },
  ],
};
export interface BootstrapOptions extends AppDependencies {
  port?: number;
  host?: string;
  effects?: Partial<BootstrapEffects>;
}

function listen(app: Express, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

/** Initialize before accepting traffic. Failed startup unwinds every acquired resource. */
export async function bootstrap(options: BootstrapOptions = {}) {
  const env = { ...(options.env ?? process.env) };
  const effects = { ...productionEffects, ...options.effects };
  const cleanup: Stop[] = [];
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      const failures: unknown[] = [];
      for (const close of cleanup.reverse()) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, "Server teardown failed");
    })());
  const start = async (service: StartupService) => {
    // Register before starting: a service may acquire resources and then reject.
    cleanup.push(service.stop);
    await service.start();
  };
  try {
    await start(effects.database);
    await start(effects.storage);
    const app = createApp({ ...options, env });
    await start(effects.mcp);
    const server = await listen(
      app,
      options.port ?? Number(env.PORT ?? 4200),
      options.host ?? "0.0.0.0"
    );
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeIdleConnections();
        })
    );
    if (isLiveProduction(env)) {
      for (const job of effects.jobs) await start(job);
    }
    return { app, server, stop };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Server startup and teardown failed", {
        cause: cleanupError,
      });
    }
    throw error;
  }
}
