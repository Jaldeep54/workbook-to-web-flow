/**
 * Every failure the API returns deliberately is an ApiError: it carries the
 * HTTP status, a stable machine-readable code the frontend can branch on, and
 * optional field-level details. Anything else that escapes a handler is a bug
 * and becomes a generic 500 (never leaking internals to the client).
 */
export type ErrorDetail = { field: string; message: string };

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(statusCode: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = "Bad request", details?: ErrorDetail[]) {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }

  static validation(message = "Validation failed", details?: ErrorDetail[]) {
    return new ApiError(422, "VALIDATION_ERROR", message, details);
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, "UNAUTHENTICATED", message);
  }

  static forbidden(message = "You do not have permission to perform this action") {
    return new ApiError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Resource not found") {
    return new ApiError(404, "NOT_FOUND", message);
  }

  static conflict(message = "Resource already exists") {
    return new ApiError(409, "CONFLICT", message);
  }

  static tooManyRequests(message = "Too many requests, please try again later") {
    return new ApiError(429, "RATE_LIMITED", message);
  }

  static internal(message = "Something went wrong") {
    return new ApiError(500, "INTERNAL_ERROR", message);
  }
}
