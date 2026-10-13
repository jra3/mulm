import { addAlias } from "module-alias";
import path from "path";
addAlias("@", path.join(__dirname));

import { bootstrap } from "./bootstrap";
import { logger } from "./utils/logger";

void bootstrap()
  .then(({ server, stop }) => {
    logger.info("Server listening", { address: server.address() });
    const shutdown = () => {
      void stop().catch((error) => {
        logger.error("Failed to stop server", error);
        process.exitCode = 1;
      });
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  })
  .catch((error) => {
    logger.error("Failed to start server", error);
    process.exitCode = 1;
  });
