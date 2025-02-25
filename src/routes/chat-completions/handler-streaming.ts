import type { Context } from "hono"
import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"
import { logToFile } from "~/lib/logger"

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
          for await (const chunk of response) {
            try {
              await stream.writeSSE(chunk as SSEMessage)
            } catch (writeError) {
              consola.error(`Stream write error: ${(writeError as Error).message}`)
              await logToFile("stream-write-error", `${(writeError as Error).message}`)
              // Continue attempting to process the stream despite write errors
            }
          }
        } catch (streamError) {
          consola.error(`Stream processing error: ${(streamError as Error).message}`)
          await logToFile("stream-processing-error", `${(streamError as Error).message}`)
          
          // Try to send a final error message to the client
          try {
            await stream.writeSSE({
              data: JSON.stringify({
                error: {
                  message: "Stream processing error occurred",
                  type: "stream_error"
                }
              }),
              event: "error"
            })
          } catch (finalError) {
            consola.error(`Failed to send final error message: ${(finalError as Error).message}`)
          }
        }
      })
    } catch (error) {
      consola.error(`Failed to initialize stream: ${(error as Error).message}`)
      throw error; // Let the main route handler deal with this
    }
  }

  // For non-streaming requests
  const response = await chatCompletions(payload)
  return c.json(response)
}
