// Local MongoDB for development without installing MongoDB: a single-node replica set
// (Prisma needs a replica set for transactions). Data persists in .mongo-data/.
// Usage: npm run db:local   then set DATABASE_URL="mongodb://127.0.0.1:27017/nokshi?replicaSet=rs0"
import { mkdirSync } from "node:fs";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const port = Number(process.env.MONGO_PORT || 27017);
const dbPath = process.env.MONGO_DATA_DIR || ".mongo-data";
mkdirSync(dbPath, { recursive: true });

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: "rs0", count: 1, storageEngine: "wiredTiger" },
  instanceOpts: [{ port, dbPath }],
});

console.log(`MongoDB replica set ready: mongodb://127.0.0.1:${port}/nokshi?replicaSet=rs0`);
console.log("Press Ctrl+C to stop.");

const stop = async () => {
  await replSet.stop({ doCleanup: false });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
