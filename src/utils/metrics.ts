import config from '../config.json';
import { logger } from './logger';

export interface QueryMetric {
  timestamp: number;
  query: string;
  normalizedQuery: string;
  executionTime: number;
  resultCount?: number;
  connectionType: 'read' | 'write';
  error?: string;
}

export interface QueryStats {
  count: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  p95Time: number;
  p99Time: number;
  lastExecuted: number;
  errorCount: number;
}

export interface MetricsSummary {
  totalQueries: number;
  totalTime: number;
  avgQueryTime: number;
  slowQueries: number;
  errors: number;
  topQueries: Array<{ query: string; stats: QueryStats }>;
  recentSlowQueries: QueryMetric[];
  queryPatterns: Record<string, QueryStats>;
}

class MetricsCollector {
  private metrics: QueryMetric[] = [];
  private queryPatterns: Map<string, QueryMetric[]> = new Map();
  private readonly maxMetrics: number;
  private readonly retentionMs: number;

  constructor() {
    this.maxMetrics = config.monitoring.maxMetricsInMemory;
    this.retentionMs = config.monitoring.metricsRetentionHours * 60 * 60 * 1000;
  }

  recordQuery(metric: QueryMetric): void {
    if (!config.monitoring.enabled) return;

    // Add to main metrics array
    this.metrics.push(metric);
    
    // Group by normalized query pattern
    const pattern = metric.normalizedQuery;
    if (!this.queryPatterns.has(pattern)) {
      this.queryPatterns.set(pattern, []);
    }
    this.queryPatterns.get(pattern)!.push(metric);

    // Clean up old metrics if needed
    this.cleanup();

    // Log slow queries
    if (config.monitoring.logSlowQueries && metric.executionTime > config.monitoring.slowQueryThreshold) {
      logger.warn(`Slow query detected: ${metric.executionTime}ms`, {
        query: metric.query,
        executionTime: metric.executionTime,
        resultCount: metric.resultCount,
        connectionType: metric.connectionType
      });
    }

    // Log all queries if enabled
    if (config.monitoring.logQueries) {
      logger.info(`Query executed: ${metric.executionTime}ms`, {
        query: metric.normalizedQuery,
        executionTime: metric.executionTime,
        resultCount: metric.resultCount
      });
    }
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.retentionMs;
    
    // Remove old metrics from main array
    this.metrics = this.metrics.filter(m => m.timestamp > cutoff);
    
    // Keep only recent metrics, respect max limit
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Clean up query patterns
    for (const [pattern, patternMetrics] of this.queryPatterns.entries()) {
      const filtered = patternMetrics.filter(m => m.timestamp > cutoff);
      if (filtered.length === 0) {
        this.queryPatterns.delete(pattern);
      } else {
        this.queryPatterns.set(pattern, filtered.slice(-1000)); // Keep last 1000 per pattern
      }
    }
  }

  getMetrics(): QueryMetric[] {
    return [...this.metrics];
  }

  getSlowQueries(threshold?: number): QueryMetric[] {
    const slowThreshold = threshold || config.monitoring.slowQueryThreshold;
    return this.metrics.filter(m => m.executionTime > slowThreshold);
  }

  getQueryStats(normalizedQuery: string): QueryStats | null {
    const patternMetrics = this.queryPatterns.get(normalizedQuery);
    if (!patternMetrics || patternMetrics.length === 0) return null;

    const times = patternMetrics.map(m => m.executionTime).sort((a, b) => a - b);
    const errorCount = patternMetrics.filter(m => m.error).length;

    return {
      count: patternMetrics.length,
      totalTime: times.reduce((sum, time) => sum + time, 0),
      avgTime: times.reduce((sum, time) => sum + time, 0) / times.length,
      minTime: times[0],
      maxTime: times[times.length - 1],
      p95Time: times[Math.floor(times.length * 0.95)] || times[times.length - 1],
      p99Time: times[Math.floor(times.length * 0.99)] || times[times.length - 1],
      lastExecuted: Math.max(...patternMetrics.map(m => m.timestamp)),
      errorCount
    };
  }

  getSummary(): MetricsSummary {
    const totalQueries = this.metrics.length;
    const totalTime = this.metrics.reduce((sum, m) => sum + m.executionTime, 0);
    const avgQueryTime = totalQueries > 0 ? totalTime / totalQueries : 0;
    const slowQueries = this.getSlowQueries().length;
    const errors = this.metrics.filter(m => m.error).length;

    // Get top queries by frequency
    const topQueries = Array.from(this.queryPatterns.entries())
      .map(([query, metrics]) => ({ 
        query, 
        stats: this.getQueryStats(query)! 
      }))
      .filter(item => item.stats)
      .sort((a, b) => b.stats.count - a.stats.count)
      .slice(0, 10);

    // Get recent slow queries
    const recentSlowQueries = this.getSlowQueries()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    // Get all query patterns with stats
    const queryPatterns: Record<string, QueryStats> = {};
    for (const [pattern, _] of this.queryPatterns) {
      const stats = this.getQueryStats(pattern);
      if (stats) {
        queryPatterns[pattern] = stats;
      }
    }

    return {
      totalQueries,
      totalTime,
      avgQueryTime,
      slowQueries,
      errors,
      topQueries,
      recentSlowQueries,
      queryPatterns
    };
  }

  reset(): void {
    this.metrics = [];
    this.queryPatterns.clear();
  }
}

// Export singleton instance
export const metricsCollector = new MetricsCollector();

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