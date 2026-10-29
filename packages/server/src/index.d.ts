import type { IncomingMessage, ServerResponse } from 'node:http'

export type AgentCard = {
  name: string
  chat?: string
  status?: 'active' | 'paused' | 'draft' | 'archived' | string
  spec?: string
  oauth?: string
}

export type Turn = {
  message: string
  context: Record<string, unknown>
  reply: string | null
}

export type AnswerInput = {
  message: string
  context: Record<string, unknown>
  history: Turn[]
  account: string | null
  scope: 'read' | 'write' | null
  caller: string
}

export type AnswerError = { error: { code: string; message: string } }

export type AnswerResult =
  | string
  | { reply: string }
  | AnswerError
  | { confirm: { summary: string; authorization_details?: unknown[] }; reply?: string }

export type Answer = (input: AnswerInput) => AnswerResult | Promise<AnswerResult>

export type CapServerOptions = {
  agent: AgentCard
  answer: Answer
  /** Checks the company's own user store. Returning an account id turns on OAuth. */
  login?: (input: { username: string; password: string }) => string | null | Promise<string | null>
  /**
   * Reads the company's own session from the request headers and returns the
   * signed-in account id. The login and confirm pages then ask only for the decision.
   */
  currentAccount?: (input: { headers: Record<string, string | string[] | undefined> }) => string | null | Promise<string | null>
  /** Runs once after a person approves a held action. */
  act?: (input: { account: string; authorization_details: unknown; caller: string }) => { message: string } | { error: { message: string } } | Promise<{ message: string } | { error: { message: string } }>
  write?: boolean
  allowHttpClients?: boolean
  grants?: { token: string; account: string; client: string; scope?: 'read' | 'write' }[]
  waitSeconds?: number
  waitMs?: number
  retryAfter?: number
  retentionHours?: number
  dailyLimit?: number
  maxTurns?: number
  publicUrl?: string
  databaseUrl?: string
  /** SQLite file, or `:memory:`. Ignored when databaseUrl is a Postgres URL. */
  sqlitePath?: string
  accessTokenSeconds?: number
  writeAccessTokenSeconds?: number
  deviceInterval?: number
  hint?: string
  fetch?: typeof fetch
  extraRoutes?: (req: IncomingMessage, res: ServerResponse, url: URL) => boolean | Promise<boolean>
}

export type ListenAddress = {
  port: number
  address: string
  family: string
}

export type AccountAccess = { account: string; scope: 'read' | 'write'; caller: string }

export type ApprovalResult =
  | { confirmation: { id: string; status: 'pending'; url: string; summary: string; expires_at: string } }
  | AnswerError

export type AccountHelpers = {
  /** The account behind the request's bearer token, for your own account routes. Null without a valid token for the agent in CAP-From. */
  accountFor(request: Request | IncomingMessage): Promise<AccountAccess | null>
  /** Holds an action until the person approves it on the confirm page. `act` runs it once after. */
  requestApproval(request: Request | IncomingMessage, input: { summary: string; authorization_details?: unknown[] }): Promise<ApprovalResult>
}

export type CapServer = AccountHelpers & {
  listen(port?: number, host?: string): Promise<ListenAddress | string | null>
  close(): Promise<void>
  fetch(request: Request): Promise<Response>
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
}

export function createCapServer(options: CapServerOptions): Promise<CapServer>

export function createCapHandler(options: CapServerOptions): Promise<AccountHelpers & {
  handle(request: Request): Promise<Response>
  close(): Promise<void>
}>

export function checkDoor(origin: string, options?: {
  message?: string
  timeoutMs?: number
  fetch?: typeof fetch
}): Promise<{ ok: boolean; failures: string[] }>
