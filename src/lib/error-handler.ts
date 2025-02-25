// Create a new utility file for error handling and retry logic
import consola from "consola";
import { logToFile } from "~/lib/logger";

// Circuit breaker state
let consecutiveFailures = 0;
const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT = 60000; // 1 minute
let circuitOpen = false;
let circuitResetTimer: NodeJS.Timeout | null = null;

// Track when the circuit was last opened
let lastCircuitOpenTime = 0;

// Store recent failures for analysis
const recentFailures: Array<{
  timestamp: number;
  statusCode: number | undefined;
  message: string;
}> = [];
const MAX_RECENT_FAILURES = 20;

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  retryableStatusCodes: number[];
  nonCountingErrors: string[]; // Error messages that should not count toward circuit breaking
}

// Default retry options
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffFactor: 2,
  maxDelayMs: 10000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  nonCountingErrors: [
    "aborted",
    "abort",
    "operation was aborted",
    "user aborted",
    "canceled",
    "cancelled",
    "timeout",
    "socket hang up",
    "network error"
  ]
};

/**
 * Checks if the circuit breaker is open
 */
export function isCircuitOpen() {
  return circuitOpen;
}

/**
 * Gets failure statistics for debugging
 */
export function getFailureStats() {
  return {
    consecutiveFailures,
    circuitOpen,
    lastCircuitOpenTime: lastCircuitOpenTime > 0 ? new Date(lastCircuitOpenTime).toISOString() : null,
    recentFailures: [...recentFailures]
  };
}

/**
 * Records a successful API call and resets failure count
 */
export function recordSuccess() {
  consecutiveFailures = 0;
  // If circuit is open and we get a success, close it
  if (circuitOpen) {
    circuitOpen = false;
    consola.info("Circuit breaker closed after successful request");
    logToFile("circuit-breaker", "Circuit closed after successful request");
    
    if (circuitResetTimer) {
      clearTimeout(circuitResetTimer);
      circuitResetTimer = null;
    }
  }
}

/**
 * Checks if an error should be ignored for circuit breaker purposes
 */
export function isNonCountingError(errorMessage: string, options: RetryOptions = DEFAULT_RETRY_OPTIONS): boolean {
  if (!errorMessage) return false;
  
  const normalizedError = errorMessage.toLowerCase();
  return options.nonCountingErrors.some(term => normalizedError.includes(term.toLowerCase()));
}

/**
 * Records a failed API call and potentially opens the circuit
 */
export function recordFailure(statusCode: number | undefined, errorMessage?: string, options: RetryOptions = DEFAULT_RETRY_OPTIONS) {
  // Store in recent failures for analysis
  recentFailures.unshift({
    timestamp: Date.now(),
    statusCode,
    message: errorMessage || "Unknown error"
  });
  
  // Keep only the most recent failures
  if (recentFailures.length > MAX_RECENT_FAILURES) {
    recentFailures.pop();
  }
  
  // Check if this is a non-counting error like aborts or timeouts
  if (errorMessage && isNonCountingError(errorMessage, options)) {
    consola.info(`Non-counting error detected: ${errorMessage}`);
    logToFile("non-counting-error", `${errorMessage}, status: ${statusCode}`);
    return;
  }
  
  consecutiveFailures++;
  
  consola.warn(`API failure recorded (${consecutiveFailures}/${FAILURE_THRESHOLD}), status: ${statusCode}, message: ${errorMessage || "Unknown error"}`);
  logToFile("circuit-breaker", `API failure recorded (${consecutiveFailures}/${FAILURE_THRESHOLD}), status: ${statusCode}, message: ${errorMessage || "Unknown error"}`);
  
  // Open the circuit if we've reached the threshold
  if (consecutiveFailures >= FAILURE_THRESHOLD && !circuitOpen) {
    circuitOpen = true;
    lastCircuitOpenTime = Date.now();
    consola.warn("Circuit breaker opened");
    logToFile("circuit-breaker", "Circuit breaker opened");
    
    // Schedule circuit reset
    circuitResetTimer = setTimeout(() => {
      circuitOpen = false;
      consecutiveFailures = 0;
      consola.info("Circuit breaker reset automatically after timeout");
      logToFile("circuit-breaker", "Circuit breaker reset automatically after timeout");
    }, RESET_TIMEOUT);
  }
}

/**
 * Sleep for a given number of milliseconds
 */
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Calculate exponential backoff time with jitter
 */
export function calculateBackoff(attempt: number, options: RetryOptions): number {
  const baseDelay = Math.min(
    options.maxDelayMs,
    options.initialDelayMs * Math.pow(options.backoffFactor, attempt)
  );
  // Add jitter (±20%)
  const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
  return baseDelay + jitter;
}

/**
 * Determines if a request should be retried based on error
 */
export function shouldRetry(statusCode: number, errorMessage?: string, options: RetryOptions = DEFAULT_RETRY_OPTIONS): boolean {
  // If it's an aborted operation or timeout, we should not retry
  if (errorMessage && isNonCountingError(errorMessage, options)) {
    return false;
  }
  
  // Always retry 500 errors with 'Unknown streaming error' to handle intermittent streaming issues
  if (statusCode === 500 && errorMessage?.includes('Unknown streaming error')) {
    return true;
  }
  
  return options.retryableStatusCodes.includes(statusCode);
}