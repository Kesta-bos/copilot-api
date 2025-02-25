import type { Context } from "hono"
import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"
import { logToFile } from "~/lib/logger"
import { isNonCountingError } from "~/lib/error-handler"

import type { ChatCompletionsPayload } from "~/services/copilot/chat-completions/types"

import { chatCompletions } from "~/services/copilot/chat-completions/service"
import { chatCompletionsStream } from "~/services/copilot/chat-completions/service-streaming"

export async function handlerStreaming(c: Context) {
  const payload = await c.req.json<ChatCompletionsPayload>()

  const loggedPayload = structuredClone(payload)
  loggedPayload.messages = loggedPayload.messages.map((message) => ({
    ...message,
    content:
      typeof message.content === 'string' && message.content.length > 100 ?
        message.content.slice(0, 100 - 3) + "..."
      : message.content,
  }))
  
  consola.info(`ℹ Received request: ${JSON.stringify(loggedPayload)}`)

  if (payload.stream) {
    try {
      const response = await chatCompletionsStream(payload)

      // Enhanced streaming with error handling
      return streamSSE(c, async (stream) => {
        try {
          // Set up connection closed detection to avoid unnecessary error logs
          const aborted = new Promise<void>((_, reject) => {
            c.req.raw.signal.addEventListener("abort", () => {
              reject(new Error("Client aborted the connection"));
            });
          });

          // Process the stream with abort handling
          const processStream = async () => {
            for await (const chunk of response) {
              try {
                await stream.writeSSE(chunk as SSEMessage)
              } catch (writeError) {
                const errorMsg = (writeError as Error).message;
                
                if (isNonCountingError(errorMsg)) {
                  consola.info(`Client disconnected during stream: ${errorMsg}`);
                  await logToFile("client-disconnect", errorMsg);
                  return; // Exit gracefully when client disconnects
                } else {
                  consola.error(`Stream write error: ${errorMsg}`)
                  await logToFile("stream-write-error", errorMsg);
                  // Continue attempting to process the stream despite write errors
                }
              }
            }
          };

          // Race between normal processing and abort detection
          await Promise.race([processStream(), aborted]);
          
        } catch (streamError) {
          const errorMsg = (streamError as Error).message;
          
          // Handle aborted connections gracefully
          if (isNonCountingError(errorMsg)) {
            consola.info(`Stream processing stopped - client disconnected: ${errorMsg}`);
            await logToFile("client-disconnect", errorMsg);
            return; // End without error
          }
          
          consola.error(`Stream processing error: ${errorMsg}`)
          await logToFile("stream-processing-error", errorMsg);
          
          // Try to send a final error message to the client if still connected
          try {
            if (!c.req.raw.signal.aborted) {
              await stream.writeSSE({
                data: JSON.stringify({
                  error: {
                    message: "Stream processing error occurred",
                    type: "stream_error"
                  }
                }),
                event: "error"
              });
            }
          } catch (finalError) {
            consola.error(`Failed to send final error message: ${(finalError as Error).message}`);
          }
        }
      })
    } catch (error) {
      const errorMsg = (error as Error).message;
      
      // Handle aborted connections gracefully at the initialization level
      if (isNonCountingError(errorMsg)) {
        consola.info(`Client disconnected before stream started: ${errorMsg}`);
        await logToFile("client-disconnect-early", errorMsg);
        
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
      
      consola.error(`Failed to initialize stream: ${errorMsg}`);
      throw error; // Let the main route handler deal with this
    }
  }

  // For non-streaming requests
  const response = await chatCompletions(payload);
  return c.json(response);
}
