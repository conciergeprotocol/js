export class CapError extends Error {
  code: string
  status: number
  retryAfter?: number
  constructor(code: string, status: number, message: string, options?: { retryAfter?: number })
}

export class NoDoorError extends Error {
  domain: string
  constructor(domain: string)
}

export type Door = {
  protocol: string | null
  name: string | null
  chat: string | null
  cap: string
  oauth: string | null
  spec: string | null
  origin: string
  /** Set when the file was not served at /agent.txt on the company site. */
  source?: 'redirect' | 'link-header' | 'link-tag'
  extra: Record<string, string>
}

export type Message = {
  id: string
  status: 'working' | 'done' | 'failed'
  reply?: string
  error?: { code: string; message: string }
  confirmation?: unknown
  created_at?: string
  finished_at?: string | null
}

export type Token = {
  accessToken: string
  refreshToken?: string
  scope?: string
  expiresAt?: number
  clientId?: string
  tokenEndpoint?: string
  revocationEndpoint?: string
}

export type TokenStore = {
  get(origin: string): Token | undefined | Promise<Token | undefined>
  set(origin: string, token: Token): void | Promise<void>
  delete(origin: string): void | Promise<void>
}

export type AskOptions = {
  context?: Record<string, unknown>
  previousMessageId?: string
  idempotencyKey?: string
  signal?: AbortSignal
}

export type Thread = {
  restarted: boolean
  ask(message: string, options?: AskOptions): Promise<Message>
}

export type Client = {
  discover(domain: string): Promise<Door | null>
  ask(target: string | Door, message: string, options?: AskOptions): Promise<Message>
  get(target: string | Door, id: string): Promise<Message>
  thread(target: string | Door): Thread
  login(target: string | Door, options: {
    clientId: string
    redirectUri: string
    open: (url: string) => void | Promise<void>
    scope?: string
  }): Promise<Token>
  finishLogin(callbackUrl: string): Promise<Token>
  logout(target: string | Door): Promise<void>
}

export function createClient(options: {
  from: string
  fetch?: typeof fetch
  tokens?: TokenStore
  maxWaitMs?: number
  cache?: {
    get(key: string): unknown
    set(key: string, value: unknown): unknown
  }
  now?: () => number
  sleep?: (ms: number) => Promise<void> | void
}): Client
