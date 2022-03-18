// TODO: Create an error for each problem instead of problem codes

class BaseError {
  constructor(error) {
    this.error = error;
  }
}

class ClientConnectionError extends BaseError {}
class DBConnectionError extends BaseError {}

module.exports = {
  ClientConnectionError,
  DBConnectionError
};