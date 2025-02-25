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

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  retryableStatusCodes: number[];
}

// Default retry options
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffFactor: 2,
  maxDelayMs: 10000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

/**
 * Checks if the circuit breaker is open
 */
export function isCircuitOpen() {
  return circuitOpen;
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
 * Records a failed API call and potentially opens the circuit
 */
export function recordFailure(statusCode?: number) {
  consecutiveFailures++;
  
  consola.warn(`API failure recorded (${consecutiveFailures}/${FAILURE_THRESHOLD}), status: ${statusCode}`);
  logToFile("circuit-breaker", `API failure recorded (${consecutiveFailures}/${FAILURE_THRESHOLD}), status: ${statusCode}`);
  
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
export function shouldRetry(statusCode: number, options: RetryOptions): boolean {
  return options.retryableStatusCodes.includes(statusCode);
}