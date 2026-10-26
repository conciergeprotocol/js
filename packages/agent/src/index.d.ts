export type LlmsSource = {
  type: 'llms'
  url: string
  name?: string
}

export type McpSource = {
  type: 'mcp'
  url: string
  name?: string
  headers?: Record<string, string>
}

export type WriteTool = {
  write: true
  tool: unknown
}

export type AnswerInput = {
  message: string
  context?: Record<string, unknown>
  history?: { message: string; context?: Record<string, unknown>; reply?: string | null }[]
  account?: string | null
  scope?: 'read' | 'write' | null
  caller?: string
}

export type AnswerResult =
  | { reply: string }
  | { error: { code: string; message: string } }

export type CapAnswer = ((input: AnswerInput) => Promise<AnswerResult>) & {
  close(): Promise<void>
}

export function createAnswer(options: {
  /** A provider model object, or a `provider/model` string for the AI Gateway. */
  model: unknown
  instructions?: string
  sources?: Array<LlmsSource | McpSource>
  /** AI SDK tools. Wrap a tool as `{ write: true, tool }` to keep it off a read-only caller. */
  tools?: Record<string, unknown | WriteTool>
  maxSteps?: number
  /** Token cap for this process, reset at UTC midnight. A restart clears the count. */
  dailyTokens?: number
  /** When true, write tools run for a caller whose grant scope is `write`. */
  executeWrites?: boolean
  fetch?: typeof fetch
}): Promise<CapAnswer>
