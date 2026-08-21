import type { NextFunction, Request, Response } from "express";
import { MongoServerError } from "mongodb";
import { Error as MongooseError } from "mongoose";
import multer from "multer";
import { ZodError } from "zod";

import { isProduction } from "../config/env.js";
import { logger } from "../config/logger.js";
import { ApiError, type ErrorDetail } from "../utils/api-error.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.originalUrl} does not exist` },
  });
}

/** Turns a duplicate-key error into a readable message naming the field. */
function fromDuplicateKey(error: MongoServerError): ApiError {
  const field = Object.keys(error.keyPattern ?? {}).join(", ") || "value";
  const value = Object.values(error.keyValue ?? {}).join(", ");
  return ApiError.conflict(
    value ? `A record with ${field} "${value}" already exists` : `Duplicate ${field}`,
  );
}

function fromMongooseValidation(error: MongooseError.ValidationError): ApiError {
  const details: ErrorDetail[] = Object.values(error.errors).map((e) => ({
    field: e.path,
    message: e.message,
  }));
  return ApiError.validation("Validation failed", details);
}

/**
 * The single place errors become responses. Anything that isn't a deliberate
 * ApiError is logged with its stack and reported as a generic 500 — internal
 * messages, driver errors and stack traces never reach the client.
 */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  let apiError: ApiError;

  if (error instanceof ApiError) {
    apiError = error;
  } else if (error instanceof ZodError) {
    apiError = ApiError.validation(
      "Request validation failed",
      error.issues.map((i) => ({ field: i.path.join(".") || "(root)", message: i.message })),
    );
  } else if (error instanceof MongooseError.ValidationError) {
    apiError = fromMongooseValidation(error);
  } else if (error instanceof MongooseError.CastError) {
    apiError = ApiError.badRequest(`Invalid value for "${error.path}"`);
  } else if (error instanceof MongoServerError && error.code === 11000) {
    apiError = fromDuplicateKey(error);
  } else if (error instanceof multer.MulterError) {
    apiError =
      error.code === "LIMIT_FILE_SIZE"
        ? ApiError.badRequest("File is too large")
        : ApiError.badRequest(error.message);
  } else if (error instanceof SyntaxError && "body" in error) {
    apiError = ApiError.badRequest("Request body is not valid JSON");
  } else {
    apiError = ApiError.internal();
  }

  if (apiError.statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl}`, error);
  } else {
    logger.debug(`${req.method} ${req.originalUrl} -> ${apiError.statusCode} ${apiError.code}`);
  }

  res.status(apiError.statusCode).json({
    success: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
      ...(!isProduction && apiError.statusCode >= 500 && error instanceof Error
        ? { debug: error.message }
        : {}),
    },
  });
}
