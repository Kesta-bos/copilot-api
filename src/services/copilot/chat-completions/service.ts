import consola from "consola";
import { FetchError } from "ofetch";
import { 
  DEFAULT_RETRY_OPTIONS,
  RetryOptions,
  calculateBackoff,
  isCircuitOpen,
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
      });
      
      // Record successful request
      recordSuccess();
      return response;
      
    } catch (error) {
      // Get status code if available
      let statusCode = 0;
      if (error instanceof FetchError) {
        statusCode = error.statusCode || 0;
        consola.error(`Request failed: ${error.message}`, error.response?._data);
        logToFile("non-stream-error", `${error.message} - ${JSON.stringify(error.response?._data || {})}`);
      } else {
        consola.error(`Unknown error: ${(error as Error).message}`);
        logToFile("non-stream-error", `Unknown error: ${(error as Error).message}`);
      }

      // Record failure for circuit breaker
      recordFailure(statusCode);
      
      // Check if we should retry based on status code
      if (attempt < retryOptions.maxRetries && shouldRetry(statusCode, retryOptions)) {
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
