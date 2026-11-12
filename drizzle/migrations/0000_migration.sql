CREATE TYPE "public"."app_role" AS ENUM ('admin', 'cashier');
CREATE TYPE "public"."receipt_status" AS ENUM ('draft', 'finalized', 'cancelled');

CREATE TABLE IF NOT EXISTS "public"."users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "full_name" text NOT NULL DEFAULT '',
  "role" "public"."app_role" NOT NULL DEFAULT 'cashier',
  "active" boolean NOT NULL DEFAULT false,
  "reset_token_hash" text,
  "reset_token_expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "public"."users" ("email");

CREATE TABLE IF NOT EXISTS "public"."sessions" (
  "id" text PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "ip_hash" text,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "public"."sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "public"."sessions" ("expires_at");

CREATE TABLE IF NOT EXISTS "public"."company_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "name" text NOT NULL DEFAULT '',
  "address" text NOT NULL DEFAULT '',
  "phone" text NOT NULL DEFAULT '',
  "email" text NOT NULL DEFAULT '',
  "footer" text NOT NULL DEFAULT '',
  "currency" text NOT NULL DEFAULT 'KES' CHECK (char_length("currency") = 3),
  "number_prefix" text NOT NULL DEFAULT 'RCP' CHECK ("number_prefix" ~ '^[A-Z0-9]{1,8}$'),
  "logo_url" text,
  "stamp_url" text,
  "signature_url" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "public"."users"("id") ON DELETE SET NULL
);
INSERT INTO "public"."company_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "public"."clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL CHECK (char_length(btrim("name")) BETWEEN 1 AND 200),
  "phone" text NOT NULL DEFAULT '' CHECK (char_length("phone") <= 40),
  "address" text NOT NULL DEFAULT '' CHECK (char_length("address") <= 500),
  "active" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "clients_name_idx" ON "public"."clients" ("name");
CREATE INDEX IF NOT EXISTS "clients_phone_idx" ON "public"."clients" ("phone");

CREATE TABLE IF NOT EXISTS "public"."receipt_sequences" (
  "prefix" text NOT NULL,
  "year" integer NOT NULL,
  "last_value" bigint NOT NULL DEFAULT 0,
  PRIMARY KEY ("prefix", "year")
);

CREATE TABLE IF NOT EXISTS "public"."receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "status" "public"."receipt_status" NOT NULL DEFAULT 'draft',
  "receipt_number" text UNIQUE,
  "verification_code" text UNIQUE,
  "client_id" uuid NOT NULL REFERENCES "public"."clients"("id"),
  "customer_name" text NOT NULL,
  "customer_phone" text NOT NULL DEFAULT '',
  "customer_address" text NOT NULL DEFAULT '',
  "notes" text NOT NULL DEFAULT '' CHECK (char_length("notes") <= 2000),
  "currency" text NOT NULL DEFAULT 'KES',
  "total" numeric(14, 2) NOT NULL DEFAULT 0 CHECK ("total" >= 0),
  "payment_status" text NOT NULL DEFAULT 'paid',
  "amount_paid" numeric(14, 2) NOT NULL DEFAULT 0 CHECK ("amount_paid" >= 0),
  "balance_due" numeric(14, 2) NOT NULL DEFAULT 0 CHECK ("balance_due" >= 0),
  "payment_method" text NOT NULL DEFAULT 'M-Pesa',
  "company_snapshot" jsonb,
  "created_by" uuid NOT NULL REFERENCES "public"."users"("id"),
  "issued_by" uuid REFERENCES "public"."users"("id"),
  "issued_by_name" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "finalized_at" timestamptz,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid REFERENCES "public"."users"("id"),
  "cancel_reason" text,
  "print_count" integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "receipts_status_finalized_idx" ON "public"."receipts" ("status", "finalized_at" DESC);
CREATE INDEX IF NOT EXISTS "receipts_client_id_idx" ON "public"."receipts" ("client_id");
CREATE INDEX IF NOT EXISTS "receipts_created_at_idx" ON "public"."receipts" ("created_at" DESC);

CREATE TABLE IF NOT EXISTS "public"."receipt_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "receipt_id" uuid NOT NULL REFERENCES "public"."receipts"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "description" text NOT NULL CHECK (char_length(btrim("description")) BETWEEN 1 AND 500),
  "quantity" numeric(12, 3) NOT NULL CHECK ("quantity" > 0),
  "unit_price" numeric(14, 2) NOT NULL CHECK ("unit_price" >= 0),
  "line_total" numeric(14, 2) NOT NULL CHECK ("line_total" >= 0)
);
CREATE INDEX IF NOT EXISTS "receipt_items_receipt_pos_idx" ON "public"."receipt_items" ("receipt_id", "position");

CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "actor_id" uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "resource_type" text,
  "resource_id" text,
  "outcome" text NOT NULL DEFAULT 'success',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "public"."audit_logs" ("created_at" DESC);

CREATE TABLE IF NOT EXISTS "public"."verify_attempts" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "client_key" text NOT NULL,
  "identifier" text NOT NULL,
  "result" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "verify_attempts_client_key_idx" ON "public"."verify_attempts" ("client_key", "created_at");
CREATE INDEX IF NOT EXISTS "verify_attempts_identifier_idx" ON "public"."verify_attempts" ("identifier", "created_at");

-- Enable Row Level Security (RLS) on all public tables to prevent direct Data API exposure
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."company_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."receipt_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."receipt_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."verify_attempts" ENABLE ROW LEVEL SECURITY;
