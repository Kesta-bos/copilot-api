import { stream } from "fetch-event-stream";
import consola from "consola";
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
import { COPILOT_API_CONFIG } from "~/lib/config";
import { logToFile } from "~/lib/logger";
import { TOKENS } from "../../../lib/tokens";

import type { ChatCompletionsPayload } from "./types";

export async function chatCompletionsStream(payload: ChatCompletionsPayload, retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS) {
  // Check if circuit breaker is open
  if (isCircuitOpen()) {
    consola.warn("Circuit breaker is open, blocking request");
    throw new Error("Service temporarily unavailable. Too many recent failures to the Copilot API.");
  }

  let attempt = 0;
  
  while (attempt <= retryOptions.maxRetries) {
    try {
      consola.info(`Attempt ${attempt + 1}/${retryOptions.maxRetries + 1} for streaming request`);
      
      const response = await stream(`${COPILOT_API_CONFIG.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          ...COPILOT_API_CONFIG.headers,
          authorization: `Bearer ${TOKENS.COPILOT_TOKEN}`,
        },
        body: JSON.stringify(payload),
        onError: (err) => {
          consola.error(`Stream error: ${err.message}`);
          logToFile("stream-error", `${err.message}`);
          
          // The fetch-event-stream library will handle this error
          // but we want to record it for circuit breaker logic
          if (err.status && shouldRetry(err.status, retryOptions)) {
            recordFailure(err.status);
          }
        },
        onClose: () => {
          // This is called when the stream closes normally
          recordSuccess();
        }
      });

      // If we get here, the initial request was successful
      recordSuccess();
      return response;
      
    } catch (error: any) {
      const statusCode = error.status || error.statusCode || 0;
      consola.error(`Streaming request failed (attempt ${attempt + 1}/${retryOptions.maxRetries + 1}): ${error.message}`);
      
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
  throw new Error("Failed to get streaming response after all retries");
}
