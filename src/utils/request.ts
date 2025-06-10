import { Request } from 'express';

// Safe access to request body properties
export function getBodyParam(req: Request, key: string): unknown {
  return req.body && typeof req.body === 'object' && key in req.body 
    ? (req.body as Record<string, unknown>)[key] 
    : undefined;
}

export function getBodyString(req: Request, key: string, defaultValue = ''): string {
  return getBodyParam(req, key) as string ?? defaultValue;
}

// Safe access to query parameters
export function getQueryParam(req: Request, key: string) {
  return req.query[key];
}

// Safe access to query parameter as string
export function getQueryString(req: Request, key: string, defaultValue = ''): string {
  const value = req.query[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0];
  }
  return defaultValue;
}

// Type-safe body extraction with validation
export function safeParseBody<T>(req: Request, validator: (data: unknown) => data is T): T | null {
  if (!req.body || typeof req.body !== 'object') return null;
  return validator(req.body) ? req.body : null;
}