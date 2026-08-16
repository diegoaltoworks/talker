/**
 * libSQL-backed TalkerStore
 *
 * The real implementation: every write goes through this module's SQL
 * against the `Client` it was constructed with. `src/db/sessions.ts`'s
 * legacy singleton-backed exports are thin wrappers over this - the SQL
 * lives here once, not duplicated between the two.
 */

import type { Client } from "@libsql/client";
import { getErrorMessage } from "../core/errors";
import { logger } from "../core/logger";
import {
  TALKER_MESSAGE_STATUS_TABLE,
  TALKER_MESSAGES_TABLE,
  TALKER_SESSIONS_TABLE,
} from "./schema";
import type { MessageRecord, MessageStatusRecord, SessionRecord, TalkerStore } from "./store";

/** Wraps an already-connected libSQL `Client` - callers are responsible for running migrations first. */
export function createLibsqlTalkerStore(client: Client): TalkerStore {
  return {
    async upsertSession(session: SessionRecord): Promise<boolean> {
      try {
        await client.execute({
          sql: `
            INSERT INTO ${TALKER_SESSIONS_TABLE} (
              id, phone_number, channel, reason, language,
              started_at, ended_at, duration_ms, transfer_reason, conversation_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              channel = excluded.channel,
              reason = excluded.reason,
              language = excluded.language,
              ended_at = excluded.ended_at,
              duration_ms = excluded.duration_ms,
              transfer_reason = excluded.transfer_reason,
              conversation_id = excluded.conversation_id,
              updated_at = excluded.updated_at
          `,
          args: [
            session.id,
            session.phoneNumber,
            session.channel,
            session.reason,
            session.language,
            session.startedAt,
            session.endedAt,
            session.durationMs,
            session.transferReason || null,
            session.conversationId || null,
            Date.now(),
          ],
        });

        logger.info("session upserted", {
          sessionId: session.id,
          phoneNumber: session.phoneNumber,
          channel: session.channel,
        });
        return true;
      } catch (error) {
        logger.error("failed to upsert session", {
          sessionId: session.id,
          error: getErrorMessage(error),
        });
        return false;
      }
    },

    async insertMessage(message: MessageRecord): Promise<boolean> {
      try {
        await client.execute({
          sql: `INSERT OR IGNORE INTO ${TALKER_MESSAGES_TABLE} (id, session_id, role, content, timestamp)
                VALUES (?, ?, ?, ?, ?)`,
          args: [message.id, message.sessionId, message.role, message.content, message.timestamp],
        });
        return true;
      } catch (error) {
        logger.error("failed to insert message", {
          messageId: message.id,
          error: getErrorMessage(error),
        });
        return false;
      }
    },

    async upsertMessageStatus(record: MessageStatusRecord): Promise<boolean> {
      try {
        await client.execute({
          sql: `
            INSERT INTO ${TALKER_MESSAGE_STATUS_TABLE} (
              message_sid, channel, phone_from, phone_to, status,
              error_code, error_message, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(message_sid) DO UPDATE SET
              status = excluded.status,
              error_code = excluded.error_code,
              error_message = excluded.error_message,
              updated_at = excluded.updated_at
          `,
          args: [
            record.messageSid,
            record.channel,
            record.from,
            record.to,
            record.status,
            record.errorCode || null,
            record.errorMessage || null,
            Date.now(),
          ],
        });

        logger.info("message status upserted", {
          messageSid: record.messageSid,
          channel: record.channel,
          status: record.status,
        });
        return true;
      } catch (error) {
        logger.error("failed to upsert message status", {
          messageSid: record.messageSid,
          error: getErrorMessage(error),
        });
        return false;
      }
    },
  };
}
