import { join } from "node:path";
import readline from "node:readline";

const sessionIndex = process.argv.indexOf("--session");
const directoryIndex = process.argv.indexOf("--session-dir");
const sessionFile = sessionIndex >= 0 ? process.argv[sessionIndex + 1] : join(process.argv[directoryIndex + 1], "fake.jsonl");
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "get_state") send({ type: "response", id: command.id, success: true, data: { sessionFile } });
  else if (command.type === "prompt") {
    send({ type: "response", id: command.id, success: true, data: { disposition: "started" } });
    send({ type: "agent_start" });
    setTimeout(() => { send({ type: "tool_execution_start", toolName: "read" }); send({ type: "agent_settled" }); }, 25);
  } else if (command.type === "abort") {
    send({ type: "response", id: command.id, success: true });
    send({ type: "agent_settled" });
  }
});
