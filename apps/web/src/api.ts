import type { AppType } from '@planfrojex/api'
import { type ClientResponse, DetailedError, hc, parseResponse } from 'hono/client'

export const api = hc<AppType>(import.meta.env.VITE_API_URL ?? 'http://localhost:8787', {
  init: { credentials: 'include' },
})

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

// Unwraps a typed client call: the success body, or a RequestError with the API's message.
export async function call<T extends ClientResponse<unknown>>(
  response: T | Promise<T>,
): ReturnType<typeof parseResponse<T>> {
  try {
    return await parseResponse(response)
  } catch (error) {
    if (!(error instanceof DetailedError)) throw error
    throw new RequestError(
      error.detail?.data?.error ?? 'Something went wrong. Please try again.',
      error.statusCode,
    )
  }
}
