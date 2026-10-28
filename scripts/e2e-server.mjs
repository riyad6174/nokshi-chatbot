// Playwright web server: a throwaway MongoDB replica set, schema + seed, then `next dev` on it.
// Nothing touches your real (Atlas) database.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT || "3100";

function run(args, env) {
  // Resolve on process exit (Prisma's engine child can keep stdio open), see tests/setup/global-setup.ts.
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(" ")} exited with ${code}`))));
  });
}

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: "wiredTiger" },
  instanceOpts: [{ launchTimeout: 90_000 }],
});
const env = { ...process.env, DATABASE_URL: replSet.getUri("nokshi_e2e"), PRISMA_HIDE_UPDATE_MESSAGE: "1" };

await run([path.join(root, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], env);
await run([path.join(root, "prisma/seed.mjs")], env);

const next = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "-p", port], {
  cwd: root,
  env,
  stdio: "inherit",
});

const shutdown = async () => {
  next.kill();
  await replSet.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
next.on("exit", async (code) => {
  await replSet.stop();
  process.exit(code ?? 0);
});
