import { spawn } from "node:child_process";

const production = process.argv.includes("--production");
const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: production ? "production" : "development" },
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
