import consola from "consola";
import { FetchError } from "ofetch";
import { 
  DEFAULT_RETRY_OPTIONS,
  RetryOptions,
  calculateBackoff,
  isCircuitOpen,
  isNonCountingError,
  recordFailure,
  recordSuccess,
  shouldRetry,
  sleep
} from "~/lib/error-handler";
import { copilot } from "~/services/api-instance";
import { logToFile } from "~/lib/logger";

import type { ChatCompletionResponse, ChatCompletionsPayload } from "./types";

export async function chatCompletions(
  payload: ChatCompletionsPayload, 
  retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<ChatCompletionResponse> {
  // Check if circuit breaker is open
  if (isCircuitOpen()) {
    consola.warn("Circuit breaker is open, blocking request");
    throw new Error("Service temporarily unavailable. Too many recent failures to the Copilot API.");
  }

  let attempt = 0;
  
  while (attempt <= retryOptions.maxRetries) {
    try {
      consola.info(`Attempt ${attempt + 1}/${retryOptions.maxRetries + 1} for non-streaming request`);
      
      const response = await copilot<ChatCompletionResponse>("/chat/completions", {
        method: "POST",
        body: {
          ...payload,
          stream: false,
        },
        retry: false, // We'll handle retries ourselves
        timeout: 120000, // 2 minutes
      });
      
      // Record successful request
      recordSuccess();
      return response;
      
    } catch (error) {
      // Get status code and error message if available
      let statusCode = 0;
      let errorMessage = "";
      
      if (error instanceof FetchError) {
        statusCode = error.statusCode || 0;
        errorMessage = error.message;
        consola.error(`Request failed: ${errorMessage}`, error.response?._data);
        logToFile("non-stream-error", `${errorMessage} - ${JSON.stringify(error.response?._data || {})}`);
      } else if (error instanceof Error) {
        errorMessage = error.message;
        consola.error(`Unknown error: ${errorMessage}`);
        logToFile("non-stream-error", `Unknown error: ${errorMessage}`);
      } else {
        errorMessage = String(error);
        consola.error(`Unexpected error: ${errorMessage}`);
        logToFile("non-stream-error", `Unexpected error: ${errorMessage}`);
      }

      // Check if this is a non-counting error like aborted connections
      if (isNonCountingError(errorMessage, retryOptions)) {
        consola.info(`Ignoring non-counting error: ${errorMessage}`);
        // For aborted connections, just throw through without retry and without recording failure
        throw error;
      }
      
      // Record failure for circuit breaker
      recordFailure(statusCode, errorMessage, retryOptions);
      
      // Check if we should retry based on status code and error message
      if (attempt < retryOptions.maxRetries && shouldRetry(statusCode, errorMessage, retryOptions)) {
        const backoffTime = calculateBackoff(attempt, retryOptions);
        consola.info(`Retrying in ${backoffTime}ms...`);
        await sleep(backoffTime);
        attempt++;
      } else {
        // We've exhausted our retries or this isn't a retryable error
        throw error;
      }
    }
  }
  
  // This should not be reached, but TypeScript needs the return
  throw new Error("Failed after all retry attempts");
}
