/**
 * Custom Error Classes
 */

export class TradingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TradingError';
  }
}

export class DataFetchError extends Error {
  constructor(message, symbol = null) {
    super(message);
    this.name = 'DataFetchError';
    this.symbol = symbol;
  }
}

export class AnalysisError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnalysisError';
  }
}

export class APIError extends Error {
  constructor(message, statusCode = null) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
  }
}

export class DatabaseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class RiskManagementError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RiskManagementError';
  }
}

export class PositionSizeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PositionSizeError';
  }
}

export class ExecutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExecutionError';
  }
}

export default {
  TradingError,
  DataFetchError,
  AnalysisError,
  APIError,
  DatabaseError,
  ValidationError,
  RiskManagementError,
  PositionSizeError,
  ExecutionError,
};
