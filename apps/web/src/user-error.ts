// Screens throw UserError for messages they wrote on purpose. Anything else
// (network failures, raw API text) is shown as the generic message.
export class UserError extends Error {}

export const genericError = 'Something went wrong. Please try again.'

export const userMessage = (error: unknown) =>
  error instanceof UserError ? error.message : genericError
