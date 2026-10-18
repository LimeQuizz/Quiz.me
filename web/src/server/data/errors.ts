/**
 * Raised when a row does not exist OR belongs to another user. The two cases
 * are deliberately indistinguishable so IDs cannot be probed.
 */
export class NotFoundError extends Error {
  constructor(what = "Not found") {
    super(what);
    this.name = "NotFoundError";
  }
}

export class LimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitExceededError";
  }
}
