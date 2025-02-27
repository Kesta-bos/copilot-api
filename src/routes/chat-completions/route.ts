import consola from "consola"
import { Hono } from "hono"
import { FetchError } from "ofetch"
import { logToFile } from "~/lib/logger"
import { APP_CONFIG } from "~/lib/config"
import { isCircuitOpen, isNonCountingError, getFailureStats } from "~/lib/error-handler"

import { handler } from "./handler"
import { handlerStreaming } from "./handler-streaming"

export const completionRoutes = new Hono()

// Add an endpoint to view the circuit breaker stats
completionRoutes.get("/status", (c) => {
  return c.json(getFailureStats())
})

completionRoutes.post("/", async (c) => {
  try {
    // Check if circuit breaker is open first
    if (isCircuitOpen()) {
      consola.warn("Circuit breaker is open, returning 503 Service Unavailable")
      return c.json(
        {
          error: {
            message: "Service temporarily unavailable. The API is experiencing stability issues.",
            type: "server_error",
            code: "service_unavailable",
          }
        }, 
        503
      )
    }

    // Log the request (truncated for privacy)
    try {
      const payload = await c.req.json()
      const loggedPayload = structuredClone(payload)
      
      // Truncate message content for logging
      if (loggedPayload.messages) {
        loggedPayload.messages = loggedPayload.messages.map((message) => ({
          ...message,
          content: 
            typeof message.content === 'string' && message.content.length > 100 ?
              message.content.slice(0, 100 - 3) + "..."
            : message.content,
        }))
      }
      
      consola.info(`ℹ Received request: ${JSON.stringify(loggedPayload)}`)
    } catch (e) {
      consola.info("ℹ Received request (couldn't parse for logging)")
    }

    // Process the request based on configuration
    if (APP_CONFIG.EMULATE_STREAMING) {
      return await handler(c)
    }

    return await handlerStreaming(c)
  } catch (error) {
    // Enhanced error logging
    if (error instanceof FetchError) {
      const errorMessage = error.message;
      
      // Special handling for aborted connections
      if (isNonCountingError(errorMessage)) {
        consola.info(`Client aborted connection: ${errorMessage}`);
        await logToFile("client-abort", errorMessage);
        
        // Return 499 Client Closed Request (not standard HTTP but used by Nginx)
        return c.json(
          {
            error: {
              message: "Client closed connection",
              type: "client_error",
              code: "client_closed_request",
            }
          },
          499
        );
      }
      
      consola.error(`Request failed: ${errorMessage}`, error.response?._data)
      
      // Log to file if enabled
      await logToFile("error", `FetchError: ${errorMessage} - ${JSON.stringify(error.response?._data || {})}`)
      
      // Return appropriate error response based on status code
      const statusCode = error.statusCode || 500
      return c.json(
        {
          error: {
            message: `Error from upstream API: ${errorMessage}`,
            type: "api_error",
            status: statusCode,
            data: error.response?._data || {},
          }
        }, 
        statusCode
      )
    }
    
    if (error instanceof Response) {
      const errorText = await error.text()
      consola.error(
        `Request failed: ${error.status} ${error.statusText}: ${errorText}`,
      )
      
      await logToFile("error", `Response error: ${error.status} ${error.statusText} - ${errorText}`)
      
      return c.json(
        {
          error: {
            message: `Error: ${error.statusText}`,
            type: "response_error",
            status: error.status,
          }
        }, 
        error.status
      )
    } else if (error instanceof Error) {
      const errorMessage = error.message;
      
      // Special handling for aborted connections
      if (isNonCountingError(errorMessage)) {
        consola.info(`Client aborted connection: ${errorMessage}`);
        await logToFile("client-abort", errorMessage);
        
        // Return 499 Client Closed Request
        return c.json(
          {
            error: {
              message: "Client closed connection",
              type: "client_error",
              code: "client_closed_request",
            }
          },
          499
        );
      }
      
      consola.error("Error:", errorMessage, error.stack)
      await logToFile("error", `General error: ${errorMessage}\n${error.stack || ''}`)
      
      return c.json(
        {
          error: {
            message: `An error occurred: ${errorMessage}`,
            type: "server_error",
          }
        }, 
        500
      )
    } else {
      consola.error("Unknown error:", error)
      await logToFile("error", `Unknown error: ${JSON.stringify(error)}`)
      
      return c.json(
        {
          error: {
            message: "An unknown error occurred",
            type: "server_error",
          }
        }, 
        500
      )
    }
  }
})
