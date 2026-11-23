import * as ddb from '@aws-appsync/utils/dynamodb'
import { util } from '@aws-appsync/utils'

const MESSAGES_TABLE = 'serverless-chat-cognito-messages'
const MEMBERSHIPS_TABLE = 'serverless-chat-cognito-memberships'
const MAX_MESSAGE_LENGTH = 2000

// Channels look like /serverlesschat/channels/<name>. Anything else, including
// wildcards such as /serverlesschat/* or /serverlesschat/channels/*, returns null.
function channelName(ctx) {
    const segments = ctx.info.channel.segments
    if (segments.length !== 3 || segments[1] !== 'channels' || segments[2] === '*') {
        return null
    }
    return segments[2]
}

export const onSubscribe = {
    request(ctx) {
        const channel = channelName(ctx)
        if (!channel) {
            util.unauthorized()
        }
        // the data source is the memberships table
        return ddb.get({ key: { channel, userId: ctx.identity.sub } })
    },

    response(ctx) {
        if (ctx.error) {
            util.error(ctx.error.message, ctx.error.type)
        }
        // no membership item: the caller isn't a member of this channel
        if (!ctx.result) {
            util.unauthorized()
        }
    }
}

export const onPublish = {
    request(ctx) {
        const channel = channelName(ctx)
        if (!channel) {
            util.unauthorized()
        }
        const { sub, username, claims } = ctx.identity
        const timestamp = util.time.nowISO8601()

        // The author comes from the verified token, never from the payload
        const messages = ctx.events.map(({ id, payload }) => {
            const text = payload && payload.message
            if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_MESSAGE_LENGTH) {
                util.error('Invalid message', 'BadRequest')
            }
            return {
                eventId: id,
                item: {
                    channel,
                    // a ULID: unique, and sorts by time as a string
                    id: util.autoUlid(),
                    timestamp,
                    userId: sub,
                    username,
                    name: claims.name || username,
                    message: text,
                },
            }
        })
        ctx.stash.messages = messages

        // One transaction: the membership check and the message writes succeed or fail together
        return ddb.transactWrite({
            items: [
                {
                    conditionCheck: {
                        table: MEMBERSHIPS_TABLE,
                        key: { channel, userId: sub },
                        condition: { userId: { attributeExists: true } },
                    },
                },
                ...messages.map(({ item }) => ({
                    putItem: {
                        table: MESSAGES_TABLE,
                        key: { channel: item.channel, id: item.id },
                        item,
                    },
                })),
            ],
        })
    },

    response(ctx) {
        if (ctx.error) {
            const reasons = (ctx.result && ctx.result.cancellationReasons) || []
            // the first item in the transaction is the membership check
            if (reasons.length > 0 && reasons[0].type === 'ConditionalCheckFailed') {
                util.unauthorized()
            }
            util.error(ctx.error.message, ctx.error.type)
        }
        return ctx.stash.messages.map(({ eventId, item }) => ({
            id: eventId,
            payload: item,
        }))
    }
}
