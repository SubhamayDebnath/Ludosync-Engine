import { MongoClient, type Db } from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;

/** Lazily connects to MongoDB. Returns null if MONGODB_URI is not configured (engine still runs without persistence). */
export async function getDb(): Promise<Db | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (db) return db;
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  db = client.db();
  return db;
}

export async function closeDb() {
  await client?.close();
  client = null;
  db = null;
}
