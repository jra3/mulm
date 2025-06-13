import { Response } from 'express';
import { ApiErrorResponse } from '@/types/api-responses';

/**
 * Utility functions for consistent API responses
 */

export function createApiError(message: string, code?: string): ApiErrorResponse {
	return {
		error: message,
		...(code && { code })
	};
}

export function sendApiError(
	res: Response, 
	statusCode: number, 
	message: string, 
	code?: string
): void {
	res.status(statusCode).json(createApiError(message, code));
}

/**
 * Common error responses with consistent messaging
 */
export const ApiErrors = {
	SEARCH_FAILED: (entity: string) => createApiError(`Unable to search ${entity}`, `${entity.toUpperCase()}_SEARCH_ERROR`),
	NOT_FOUND: (entity: string) => createApiError(`${entity} not found`, `${entity.toUpperCase()}_NOT_FOUND`),
	VALIDATION_FAILED: (message?: string) => createApiError(message || 'Validation failed', 'VALIDATION_ERROR'),
	INTERNAL_ERROR: () => createApiError('Internal server error', 'INTERNAL_ERROR'),
} as const;

/**
 * Helper to send common API errors
 */
export const sendApiErrors = {
	searchFailed: (res: Response, entity: string) => sendApiError(res, 500, `Unable to search ${entity}`, `${entity.toUpperCase()}_SEARCH_ERROR`),
	notFound: (res: Response, entity: string) => sendApiError(res, 404, `${entity} not found`, `${entity.toUpperCase()}_NOT_FOUND`),
	validationFailed: (res: Response, message?: string) => sendApiError(res, 400, message || 'Validation failed', 'VALIDATION_ERROR'),
	internalError: (res: Response) => sendApiError(res, 500, 'Internal server error', 'INTERNAL_ERROR'),
} as const;