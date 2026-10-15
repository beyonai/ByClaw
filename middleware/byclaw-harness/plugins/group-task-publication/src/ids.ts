/** Wire identifiers accept numeric BE values while durable and tool results use strings. */
import { z } from 'zod'

/** Reject rounded numeric IDs; large IDs must arrive as strings to preserve their digits. */
export const publicationIdSchema = z.union([
  z.string().refine(value => value.trim().length > 0),
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String),
])
