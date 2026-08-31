import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const mailboxes = sqliteTable(
  'mailboxes',
  {
    id: text('id').primaryKey(),
    address: text('address').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_mailboxes_address').on(table.address),
    index('idx_mailboxes_expires_at').on(table.expiresAt),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    mailboxId: text('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    toAddress: text('to_address').notNull(),
    subject: text('subject').notNull().default('(No subject)'),
    textBody: text('text_body').notNull().default(''),
    htmlBody: text('html_body'),
    receivedAt: integer('received_at').notNull(),
  },
  (table) => [index('idx_messages_mailbox_received').on(table.mailboxId, table.receivedAt)],
);
