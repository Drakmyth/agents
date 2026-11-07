import { appendFile } from "node:fs/promises";
import { agentViewPaths } from "./paths.ts";
import { SupervisorServer } from "./server.ts";

const paths = agentViewPaths(process.env.PI_AGENTS_VIEW_STATE_DIR);
const server = new SupervisorServer(paths, { exitOnIdle: true });

process.on("uncaughtException", (error) => void appendFile(paths.logFile, `${new Date().toISOString()} ${error.stack ?? error.message}\n`));
process.on("SIGTERM", () => void server.close().finally(() => process.exit(0)));
process.on("SIGINT", () => void server.close().finally(() => process.exit(0)));

await server.start();
