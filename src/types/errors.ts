// TODO: Create an error for each problem instead of problem codes

class BaseError {
  error: Error

  constructor(error: Error) {
    this.error = error;
  }
}

export class ClientConnectionError extends BaseError {}
export class DBConnectionError extends BaseError {}
