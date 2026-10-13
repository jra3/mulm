import { mock } from "node:test";
import { Server } from "node:net";
import { Socket } from "node:net";
import { Database } from "sqlite";

// Loaded before the scenario's static factory imports. A hidden listener,
// database open, SMTP connection or R2 request fails at the effect boundary.
mock.method(Server.prototype, "listen", () => {
  throw new Error("Unexpected listener during app construction");
});
mock.method(Socket.prototype, "connect", () => {
  throw new Error("Unexpected network connection during app construction");
});
mock.method(Database.prototype, "open", () => {
  throw new Error("Unexpected database open during app construction");
});
