import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  bigint,
  numeric,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

export const appRoleEnum = pgEnum("app_role", ["admin", "cashier"]);
export const receiptStatusEnum = pgEnum("receipt_status", ["draft", "finalized", "cancelled"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull().default(""),
    role: appRoleEnum("role").notNull().default("cashier"),
    active: boolean("active").notNull().default(false),
    resetTokenHash: text("reset_token_hash"),
    resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // SHA-256 hex of opaque session token
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId), index("sessions_expires_at_idx").on(t.expiresAt)],
);

export const companySettings = pgTable("company_settings", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull().default(""),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  footer: text("footer").notNull().default(""),
  currency: text("currency").notNull().default("KES"),
  numberPrefix: text("number_prefix").notNull().default("RCP"),
  logoUrl: text("logo_url"),
  stampUrl: text("stamp_url"),
  signatureUrl: text("signature_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    phone: text("phone").notNull().default(""),
    address: text("address").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clients_name_idx").on(t.name), index("clients_phone_idx").on(t.phone)],
);

export const receiptSequences = pgTable(
  "receipt_sequences",
  {
    prefix: text("prefix").notNull(),
    year: integer("year").notNull(),
    lastValue: bigint("last_value", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.prefix, t.year] })],
);

export type CompanySnapshot = {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  footer?: string;
  logo_url?: string | null;
  stamp_url?: string | null;
  signature_url?: string | null;
};

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: receiptStatusEnum("status").notNull().default("draft"),
    receiptNumber: text("receipt_number").unique(),
    verificationCode: text("verification_code").unique(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull().default(""),
    customerAddress: text("customer_address").notNull().default(""),
    notes: text("notes").notNull().default(""),
    currency: text("currency").notNull().default("KES"),
    total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0.00"),
    paymentStatus: text("payment_status").notNull().default("paid"),
    amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }).notNull().default("0.00"),
    balanceDue: numeric("balance_due", { precision: 14, scale: 2 }).notNull().default("0.00"),
    paymentMethod: text("payment_method").notNull().default("M-Pesa"),
    companySnapshot: jsonb("company_snapshot").$type<CompanySnapshot | null>(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    issuedBy: uuid("issued_by").references(() => users.id),
    issuedByName: text("issued_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),
    printCount: integer("print_count").notNull().default(0),
  },
  (t) => [
    index("receipts_status_finalized_idx").on(t.status, t.finalizedAt),
    index("receipts_client_id_idx").on(t.clientId),
    index("receipts_created_at_idx").on(t.createdAt),
  ],
);

export const receiptItems = pgTable(
  "receipt_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [index("receipt_items_receipt_pos_idx").on(t.receiptId, t.position)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    outcome: text("outcome").notNull().default("success"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_created_at_idx").on(t.createdAt)],
);

export const verifyAttempts = pgTable(
  "verify_attempts",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    clientKey: text("client_key").notNull(),
    identifier: text("identifier").notNull(),
    result: text("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("verify_attempts_client_key_idx").on(t.clientKey, t.createdAt),
    index("verify_attempts_identifier_idx").on(t.identifier, t.createdAt),
  ],
);
