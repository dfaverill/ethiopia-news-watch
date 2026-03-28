import { spawn } from "node:child_process";
import path from "node:path";

const host = process.env.HOST || "0.0.0.0";
const port = process.env.PORT || "3000";

const nextBin = path.join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);

const child = spawn(
  process.execPath,
  [nextBin, "start", "--hostname", host, "--port", port],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

function forwardSignal(signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
