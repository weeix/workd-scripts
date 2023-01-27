// -------------------
// Generic Classes
// -------------------

class Credential {
  constructor(username, password) {
    this.username = username;
    this.password = password;
  }
}

// -------------------
// Error Classes
// -------------------

class ArgumentError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class WorkDLogInError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class WorkDCreateUserError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class WorkDInsufficientQuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

module.exports = {
  Credential,
  ArgumentError,
  WorkDLogInError,
  WorkDCreateUserError,
  WorkDInsufficientQuotaError
}
