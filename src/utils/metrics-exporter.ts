import dgram from 'dgram';
import config from '../config.json';
import { QueryMetric } from './query-metrics';

interface MetricsExporterConfig {
  type: 'logger' | 'statsd' | 'both' | 'none';
  statsd?: {
    host: string;
    port: number;
    prefix: string;
  };
  logger?: {
    enabled: boolean;
    includeQuery: boolean;
  };
}

class MetricsExporter {
  private udpClient?: dgram.Socket;
  private config: MetricsExporterConfig;

  constructor(config: MetricsExporterConfig) {
    this.config = config;
    
    if (config.type === 'statsd' || config.type === 'both') {
      this.udpClient = dgram.createSocket('udp4');
      this.udpClient.on('error', (err) => {
        console.error('[MetricsExporter] UDP socket error:', err);
        this.udpClient?.close();
      });
    }
  }

  exportMetric(metric: QueryMetric): void {
    if (this.config.type === 'none') return;

    // Export to logger
    if ((this.config.type === 'logger' || this.config.type === 'both') && this.config.logger?.enabled) {
      this.logMetric(metric);
    }

    // Export to StatsD/Carbon
    if (this.config.type === 'statsd' || this.config.type === 'both') {
      this.sendToStatsD(metric);
    }
  }

  private logMetric(metric: QueryMetric): void {
    const logData: any = {
      timestamp: new Date(metric.timestamp).toISOString(),
      type: 'db_query',
      connection: metric.connectionType,
      duration_ms: metric.executionTime.toFixed(2),
      result_count: metric.resultCount,
      normalized_query: metric.normalizedQuery,
      error: metric.error
    };

    if (this.config.logger?.includeQuery) {
      logData.query = metric.query;
    }

    // Log as structured JSON for easy parsing
    console.log(`[METRICS] ${JSON.stringify(logData)}`);
  }

  private sendToStatsD(metric: QueryMetric): void {
    if (!this.udpClient || !this.config.statsd) return;

    const prefix = this.config.statsd.prefix || 'mulm';
    const tags = [
      `connection:${metric.connectionType}`,
      `normalized_query:${this.sanitizeForStatsD(metric.normalizedQuery)}`,
      metric.error ? 'status:error' : 'status:success'
    ];

    // Send timing metric
    this.sendStatsDMetric(
      `${prefix}.db.query.duration`,
      metric.executionTime,
      'ms',
      tags
    );

    // Send counter for query count
    this.sendStatsDMetric(
      `${prefix}.db.query.count`,
      1,
      'c',
      tags
    );

    // Send gauge for result count if available
    if (metric.resultCount !== undefined) {
      this.sendStatsDMetric(
        `${prefix}.db.query.results`,
        metric.resultCount,
        'g',
        tags
      );
    }

    // Send error counter if error occurred
    if (metric.error) {
      this.sendStatsDMetric(
        `${prefix}.db.query.errors`,
        1,
        'c',
        tags
      );
    }
  }

  private sendStatsDMetric(
    metric: string,
    value: number,
    type: 'ms' | 'c' | 'g',
    tags: string[]
  ): void {
    if (!this.udpClient || !this.config.statsd) return;

    // StatsD format: metric:value|type|#tag1,tag2
    const message = `${metric}:${value}|${type}|#${tags.join(',')}`;
    const buffer = Buffer.from(message);

    this.udpClient.send(
      buffer,
      0,
      buffer.length,
      this.config.statsd.port,
      this.config.statsd.host,
      (err) => {
        if (err) {
          console.error('[MetricsExporter] Failed to send StatsD metric:', err);
        }
      }
    );
  }

  private sanitizeForStatsD(str: string): string {
    // Replace spaces and special chars with underscores for StatsD compatibility
    return str
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase()
      .substring(0, 100); // Limit length
  }

  close(): void {
    if (this.udpClient) {
      this.udpClient.close();
    }
  }
}

// Create and export singleton instance based on config
const exporterConfig: MetricsExporterConfig = (config as any).monitoring?.exporter || { type: 'none' };
export const metricsExporter = new MetricsExporter(exporterConfig);