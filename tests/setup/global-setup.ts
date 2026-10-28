import { spawn } from "node:child_process";
import path from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";

/**
 * Runs `prisma db push` and resolves when the CLI process exits. Deliberately not execSync:
 * Prisma's schema-engine child can hold the output streams open after the CLI exits, and an open
 * stdin makes the CLI wait for input, so waiting for streams to close hangs forever.
 */
function pushSchema(root: string, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`prisma db push timed out.\n${output.slice(-2000)}`));
    }, 300_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      if (code === 0) resolve();
      else reject(new Error(`prisma db push failed (exit ${code}).\n${output.slice(-2000)}`));
    });
  });
}

// A throwaway single-node MongoDB replica set per test run (Prisma needs a replica set for transactions).
// Workers inherit DATABASE_URL because they start after this runs. Never touches Atlas or dev data.
export default async function setup() {
  // Generous launch timeout: a cold mongod start can exceed the 10 s default on a busy machine.
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ launchTimeout: 90_000 }],
  });
  const url = replSet.getUri("nokshi_test");
  process.env.DATABASE_URL = url;

  // Creates the collections and indexes (including unique ones) from the schema.
  await pushSchema(path.resolve(__dirname, "../.."), url);

  return async () => {
    await replSet.stop();
  };
}
