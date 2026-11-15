import "server-only";
import { env } from "@/server/env";
import { openDatabase } from "./connection";

type Connection = ReturnType<typeof openDatabase>;

// Keep a single connection per Node process; survives dev-server HMR reloads.
const globalForDb = globalThis as unknown as { __travelSwipeDb?: Connection };

export const connection: Connection =
  globalForDb.__travelSwipeDb ?? (globalForDb.__travelSwipeDb = openDatabase(env.DATABASE_PATH));

export const db = connection.db;
export const sqlite = connection.sqlite;
