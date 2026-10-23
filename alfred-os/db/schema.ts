import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const entries = sqliteTable('entries', {
 id: text('id').primaryKey(), kind: text('kind').notNull(), project: text('project').notNull(),
 title: text('title').notNull(), body: text('body').notNull().default(''), status: text('status').notNull().default('inbox'),
 role: text('role').notNull().default('alfred'), externalId: text('external_id'), result: text('result'),
 createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
});
export const office = sqliteTable('office', { id: text('id').primaryKey(), value: text('value').notNull(), updatedAt: integer('updated_at').notNull() });
