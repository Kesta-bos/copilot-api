import { stream } from "fetch-event-stream";
import consola from "consola";
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
      
      // Add a specific debug log for the request payload
      const sanitizedPayload = {
        ...payload,
        messages: payload.messages ? 
          payload.messages.map(m => ({...m, content: typeof m.content === 'string' ? `${m.content.substring(0, 20)}...` : m.content})) : 
          []
      };
      consola.debug(`Streaming request payload: ${JSON.stringify(sanitizedPayload)}`);
      
      // Wrap the stream call in a try/catch to handle any upstream errors
      let response;
      try {
        response = await stream(`${COPILOT_API_CONFIG.baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            ...COPILOT_API_CONFIG.headers,
            authorization: `Bearer ${TOKENS.COPILOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          onError: (err) => {
            const errorMsg = err.message || "Unknown stream error";
            consola.error(`Stream error: ${errorMsg}`, err);
            
            // Log more detailed info about the error
            const errorDetails = {
              message: errorMsg,
              status: err.status,
              type: err.constructor.name,
              ...(err.response ? { responseData: err.response } : {})
            };
            logToFile("stream-error", JSON.stringify(errorDetails, null, 2));
            
            // Don't count aborted operations toward circuit breaker failures
            if (isNonCountingError(errorMsg, retryOptions)) {
              consola.info(`Ignoring non-counting error in stream: ${errorMsg}`);
            } 
            // Only record retryable errors for circuit breaker
            else if (err.status && shouldRetry(err.status, errorMsg, retryOptions)) {
              recordFailure(err.status, errorMsg, retryOptions);
            }
          },
          onClose: () => {
            // This is called when the stream closes normally
            recordSuccess();
          },
          // Set a reasonable timeout for the stream
          timeout: 120000, // 2 minutes
        });
      } catch (streamError: any) {
        // Handle any errors during stream initialization
        consola.error(`Stream initialization error: ${streamError.message || 'Unknown error'}`);
        throw streamError; // Re-throw to be handled by outer catch
      }

      // If we get here, the initial request was successful
      consola.info(`Stream connection established successfully on attempt ${attempt + 1}`);
      recordSuccess();
      return response;
      
    } catch (error: any) {
      const statusCode = error.status || error.statusCode || 0;
      const errorMsg = error.message || "Unknown streaming error";
      
      // Log detailed error information
      consola.error(`Streaming request failed (attempt ${attempt + 1}/${retryOptions.maxRetries + 1}): ${errorMsg}`, { 
        statusCode, 
        errorType: error.constructor.name,
        stack: error.stack
      });
      
      // Try to extract additional response details if available
      if (error.response) {
        try {
          const responseData = await error.response.json?.() || error.response._data || {};
          consola.error("Error response data:", responseData);
          logToFile("stream-error-response", JSON.stringify(responseData, null, 2));
        } catch (e) {
          consola.error("Could not parse error response");
        }
      }
      
      // Don't count aborted operations toward circuit breaker failures
      if (isNonCountingError(errorMsg, retryOptions)) {
        consola.info(`Ignoring non-counting error: ${errorMsg}`);
        // For aborted connections, just throw through without retry
        throw error;
      } else {
        // Record failure for circuit breaker
        recordFailure(statusCode, errorMsg, retryOptions);
        
        // Check if we should retry based on status code and error message
        if (attempt < retryOptions.maxRetries && (shouldRetry(statusCode, errorMsg, retryOptions) || statusCode === 500)) {
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
  }
  
  // This should not be reached, but TypeScript needs the return
  throw new Error("Failed to get streaming response after all retries");
}
