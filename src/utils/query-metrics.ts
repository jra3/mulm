import config from '../config.json';
import { logger } from './logger';
import { metricsExporter } from './metrics-exporter';

export interface QueryMetric {
  timestamp: number;
  query: string;
  normalizedQuery: string;
  executionTime: number;
  resultCount?: number;
  connectionType: 'read' | 'write';
  error?: string;
}

class QueryMetrics {
  recordQuery(metric: QueryMetric): void {
    if (!config.monitoring.enabled) return;

    // Export metric immediately
    metricsExporter.exportMetric(metric);

    // Log slow queries with the regular logger
    if (config.monitoring.logSlowQueries && metric.executionTime > config.monitoring.slowQueryThreshold) {
      logger.warn(`Slow query detected: ${metric.executionTime}ms`, {
        query: metric.query,
        executionTime: metric.executionTime,
        resultCount: metric.resultCount,
        connectionType: metric.connectionType
      });
    }
  }
}

export const queryMetrics = new QueryMetrics();

/**
 * Normalize SQL query for pattern matching
 * Replaces parameters with placeholders to group similar queries
 */
export function normalizeQuery(query: string): string {
  return query
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\b\d+\b/g, '?') // Replace numbers with ?
    .replace(/'[^']*'/g, '?') // Replace string literals with ?
    .replace(/"[^"]*"/g, '?') // Replace quoted strings with ?
    .replace(/\?\s*,\s*\?/g, '?, ?') // Normalize parameter lists
    .trim()
    .toLowerCase();
}