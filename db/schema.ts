import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  payload: text("payload").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [index("projects_owner_updated").on(t.ownerId, t.updatedAt)]);
