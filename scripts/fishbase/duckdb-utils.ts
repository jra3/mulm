/**
 * DuckDB utilities for querying FishBase data from Hugging Face
 */

import * as duckdb from 'duckdb';
import { existsSync } from 'fs';
import { join } from 'path';

const FISHBASE_VERSION = 'v24.07';
const SEALIFEBASE_VERSION = 'v24.07';
const FISHBASE_BASE_URL = `https://huggingface.co/datasets/cboettig/fishbase/resolve/main/data/fb/${FISHBASE_VERSION}/parquet`;
const SEALIFEBASE_BASE_URL = `https://huggingface.co/datasets/cboettig/sealifebase/resolve/main/data/slb/${SEALIFEBASE_VERSION}/parquet`;
const CACHE_DIR = join(__dirname, 'cache');

export interface DuckDBConnection {
  db: duckdb.Database;
  connection: duckdb.Connection;
  run: (sql: string, ...params: any[]) => Promise<void>;
  all: <T = any>(sql: string, ...params: any[]) => Promise<T[]>;
  close: () => Promise<void>;
}

/**
 * Create a DuckDB connection with httpfs extension loaded
 */
export async function createDuckDBConnection(dbPath: string = ':memory:'): Promise<DuckDBConnection> {
  const db = new duckdb.Database(dbPath);
  const connection = db.connect();

  // Wrapper functions with proper types
  const run = async (sql: string, ...params: any[]): Promise<void> => {
    return new Promise((resolve, reject) => {
      connection.run(sql, ...params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  const all = async <T = any>(sql: string, ...params: any[]): Promise<T[]> => {
    return new Promise((resolve, reject) => {
      connection.all(sql, ...params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  };

  // Load httpfs extension for reading remote parquet files
  await run('INSTALL httpfs;');
  await run('LOAD httpfs;');

  return {
    db,
    connection,
    run,
    all,
    close: async () => {
      return new Promise((resolve, reject) => {
        connection.close((err) => {
          if (err) reject(err);
          db.close((err) => {
            if (err) reject(err);
            resolve();
          });
        });
      });
    }
  };
}

/**
 * Get the URL or local path for a FishBase table
 * Checks local cache first, falls back to remote URL
 */
export function getFishBaseTableUrl(tableName: string, database: 'fishbase' | 'sealifebase' = 'fishbase'): string {
  // Check for local cached file first
  const localPath = join(CACHE_DIR, `${tableName}.parquet`);
  if (existsSync(localPath)) {
    return localPath;
  }

  // Fall back to remote URL
  const baseUrl = database === 'fishbase' ? FISHBASE_BASE_URL : SEALIFEBASE_BASE_URL;
  return `${baseUrl}/${tableName}.parquet`;
}

/**
 * Create a view for a FishBase table
 */
export async function createFishBaseView(
  conn: DuckDBConnection,
  tableName: string,
  viewName?: string,
  database: 'fishbase' | 'sealifebase' = 'fishbase'
): Promise<void> {
  const view = viewName || `fb_${tableName}`;
  const url = getFishBaseTableUrl(tableName, database);

  await conn.run(`
    CREATE OR REPLACE VIEW ${view} AS
    SELECT * FROM '${url}';
  `);
}

/**
 * List available FishBase tables (common ones)
 */
export const FISHBASE_TABLES = {
  // Core tables
  species: 'species',
  genera: 'genera',
  families: 'families',
  orders: 'orders',

  // Names
  comnames: 'comnames',
  synonyms: 'synonyms',

  // Ecology & Habitat
  ecology: 'ecology',
  stocks: 'stocks',
  ecosystem: 'ecosystem',

  // Reproduction
  spawning: 'spawning',
  spawnagg: 'spawnagg',
  fecundity: 'fecundity',
  maturity: 'maturity',

  // Physical characteristics
  morphdat: 'morphdat',
  morphmet: 'morphmet',

  // Distribution
  country: 'country',
  faoareas: 'faoareas',

  // References
  refrens: 'refrens',
} as const;

export type FishBaseTable = keyof typeof FISHBASE_TABLES;
