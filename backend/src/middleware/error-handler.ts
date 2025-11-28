import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
  statusCode?: number;
  details?: unknown;
}

export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error:', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  const errorObj: { message: string; stack?: string; details?: unknown } = { message };
  if (process.env.NODE_ENV === 'development' && err.stack) {
    errorObj.stack = err.stack;
  }
  if (err.details) {
    errorObj.details = err.details;
  }

  res.status(statusCode).json({
    success: false,
    error: errorObj,
  });
}

export function createError(message: string, statusCode: number = 500, details?: unknown): ApiError {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}
