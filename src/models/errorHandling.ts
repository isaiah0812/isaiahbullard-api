export class ValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super();
    
    this.field = field;
    this.message = message;
  }
}

export class CreateError extends Error {
  readonly collectionName: string;

  constructor(collectionName: string, message: string) {
    super();

    this.collectionName = collectionName;
    this.message = message;
  }
}

export class InternalServerError extends Error {
  cause?: Error;

  constructor(cause?: Error) {
    super();

    this.message = "Internal Server Error."
    this.cause = cause;
  }
}

export const ID_FIELD_NAME = "id";
export const ID_FIELD_ERROR_MESSAGE = "Field must be a string matching ^[a-z0-9-]*$";

export const COVER_FIELD_NAME = "cover";

export const URL_FIELD_ERROR_MESSAGE = "Field must be a valid URL string";
