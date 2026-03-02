export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} ${id} not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class IdempotencyConflictError extends AppError {
  constructor() {
    super('IDEMPOTENCY_CONFLICT', 'Idempotency-Key already used with a different payload', 409);
    this.name = 'IdempotencyConflictError';
  }
}

export class TranslationError extends AppError {
  constructor(rail: string, message: string, details?: Record<string, unknown>) {
    super('TRANSLATION_ERROR', message, 422, { rail, ...details });
    this.name = 'TranslationError';
  }
}

export class RoutingError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('ROUTING_ERROR', message, 422, details);
    this.name = 'RoutingError';
  }
}

export class RailCommunicationError extends AppError {
  constructor(rail: string, message: string) {
    super('RAIL_COMMUNICATION_ERROR', message, 502, { rail });
    this.name = 'RailCommunicationError';
  }
}
