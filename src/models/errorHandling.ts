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

export const ARRAY_REQUIRED_MESSAGE = "Field must be an array";

export const ID_FIELD_NAME = "id";
export const ID_FIELD_ERROR_MESSAGE = "Field must be a string matching ^[a-z0-9-]*$";

export const COVER_FIELD_NAME = "cover";
export const DATE_FIELD_ERROR_MESSAGE = "Field must be a valid date."

export const RELEASE_DATE_FIELD_NAME = "releaseDate";
export const STRING_NOT_EMPTY_MESSAGE = "Field must be a non-empty string";
export const TITLE_FIELD_NAME = "title";

export const URL_FIELD_ERROR_MESSAGE = "Field must be a valid URL string";
