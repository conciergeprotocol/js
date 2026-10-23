import { CapError, NoDoorError } from '@conciergeprotocol/client'

const ASK_HINT = 'The company is still answering. Call cap_check with this message_id. Do not write a reply for the company.'

export function createTools(cap) {
  return {
    async cap_discover({ domain }) {
      const door = await cap.discover(domain)
      if (!door) return { door: false }
      return {
        door: true,
        name: door.name,
        chat: door.chat,
        login: Boolean(door.oauth),
        found: door.source || 'agent.txt',
      }
    },

    async cap_ask({ domain, message, context, conversation_id }) {
      try {
        const answer = await cap.ask(domain, message, {
          context,
          previousMessageId: conversation_id,
        })
        if (answer.status === 'working') {
          return {
            status: 'working',
            message_id: answer.id,
            conversation_id: answer.id,
            message: ASK_HINT,
          }
        }
        if (answer.status === 'failed') {
          return { status: 'failed', error: answer.error, conversation_id: answer.id }
        }
        return { status: 'done', reply: answer.reply, conversation_id: answer.id }
      } catch (err) {
        if (err instanceof NoDoorError) {
          return { door: false, message: `${domain} has no CAP front door. Browse the site instead.` }
        }
        throw err
      }
    },

    async cap_check({ domain, message_id }) {
      const answer = await cap.get(domain, message_id)
      if (answer.status === 'working') {
        return { status: 'working', message_id: answer.id, message: ASK_HINT }
      }
      if (answer.status === 'failed') return { status: 'failed', error: answer.error, message_id: answer.id }
      return { status: 'done', reply: answer.reply, message_id: answer.id }
    },
  }
}

export function toolError(err) {
  if (err instanceof CapError) return err.message
  return 'The front door could not be reached.'
}
