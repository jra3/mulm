import { Database } from 'sqlite';
import { metricsCollector, normalizeQuery, QueryMetric } from '../utils/metrics';
import config from '../config.json';

/**
 * Wraps a database query function with performance monitoring
 */
export function withPerformanceMonitoring<T extends any[], R>(
  originalFn: (...args: T) => Promise<R>,
  queryExtractor: (...args: T) => string,
  connectionType: 'read' | 'write' = 'read'
) {
  return async (...args: T): Promise<R> => {
    if (!config.monitoring.enabled) {
      return originalFn(...args);
    }

    const query = queryExtractor(...args);
    const startTime = process.hrtime.bigint();
    
    let result: R;
    let error: string | undefined;
    let resultCount: number | undefined;

    try {
      result = await originalFn(...args);
      
      // Try to extract result count if it's an array
      if (Array.isArray(result)) {
        resultCount = result.length;
      }
      
      return result;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1_000_000; // Convert to milliseconds

      const metric: QueryMetric = {
        timestamp: Date.now(),
        query,
        normalizedQuery: normalizeQuery(query),
        executionTime,
        resultCount,
        connectionType,
        error
      };

      metricsCollector.recordQuery(metric);
    }
  };
}

/**
 * Wraps Database.prepare() method with performance monitoring
 */
export function withStatementMonitoring(db: Database, connectionType: 'read' | 'write' = 'read') {
  const originalPrepare = db.prepare.bind(db);
  
  db.prepare = async function(sql: string) {
    const stmt = await originalPrepare(sql);
    
    // Wrap statement methods
    const originalRun = stmt.run.bind(stmt);
    const originalGet = stmt.get.bind(stmt);
    const originalAll = stmt.all.bind(stmt);

    stmt.run = withPerformanceMonitoring(
      originalRun,
      () => sql,
      connectionType
    );

    stmt.get = withPerformanceMonitoring(
      originalGet,
      () => sql,
      connectionType
    );

    stmt.all = withPerformanceMonitoring(
      originalAll,
      () => sql,
      connectionType
    );

    return stmt;
  };

  return db;
}

/**
 * Wraps Database.exec() method with performance monitoring
 */
export function withExecMonitoring(db: Database, connectionType: 'read' | 'write' = 'read') {
  const originalExec = db.exec.bind(db);
  
  db.exec = withPerformanceMonitoring(
    originalExec,
    (sql: string) => sql,
    connectionType
  );

  return db;
}

/**
 * Wraps all database methods with performance monitoring
 */
export function withDatabaseMonitoring(db: Database, connectionType: 'read' | 'write' = 'read'): Database {
  if (!config.monitoring.enabled) {
    return db;
  }

  // Wrap the database methods
  withStatementMonitoring(db, connectionType);
  withExecMonitoring(db, connectionType);

  return db;
}