export class CapError extends Error {
  constructor(code, status, message, options = {}) {
    super(message)
    this.name = 'CapError'
    this.code = code
    this.status = status
    if (options.retryAfter != null) this.retryAfter = options.retryAfter
  }
}

export class NoDoorError extends Error {
  constructor(domain) {
    super(`${domain} has no CAP front door.`)
    this.name = 'NoDoorError'
    this.domain = domain
  }
}
