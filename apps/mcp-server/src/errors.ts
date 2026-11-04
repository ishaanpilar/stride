export type StrideToolErrorCode = 'read_only' | 'not_found' | 'validation_error' | 'internal_error';

export class StrideToolError extends Error {
  readonly code: StrideToolErrorCode;

  constructor(message: string, code: StrideToolErrorCode) {
    super(message);
    this.name = 'StrideToolError';
    this.code = code;
  }
}

export class ReadOnlyError extends StrideToolError {
  constructor(message = 'Database opened read-only. Start the server with --write to enable edits.') {
    super(message, 'read_only');
    this.name = 'ReadOnlyError';
  }
}

export class NotFoundError extends StrideToolError {
  constructor(message: string) {
    super(message, 'not_found');
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends StrideToolError {
  constructor(message: string) {
    super(message, 'validation_error');
    this.name = 'ValidationError';
  }
}

export const getStrideToolErrorCode = (error: unknown): StrideToolErrorCode =>
  error instanceof StrideToolError ? error.code : 'internal_error';
