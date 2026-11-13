"""MP-14 Canonical IBMS Database Architecture & Financial Integrity Schema

Revision ID: 20261112_0001
Revises: None
Create Date: 2026-11-12 16:00:00

Establishes the complete 37-table canonical IBMS schema across all 13 functional modules,
while preserving all existing production tables and data on Supabase PostgreSQL.
"""

from typing import Sequence, Union
from alembic import op

revision: str = "20261112_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -------------------------------------------------------------------------
    # 0. Enums & Baseline Table Extensions (Non-Destructive)
    # -------------------------------------------------------------------------
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE public.app_role AS ENUM ('admin', 'cashier');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;

        DO $$ BEGIN
            CREATE TYPE public.receipt_status AS ENUM ('draft', 'finalized', 'cancelled');
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;
        """
    )

    # Ensure baseline tables exist (when running against a clean test DB)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.users (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            email text NOT NULL UNIQUE,
            password_hash text NOT NULL,
            full_name text NOT NULL DEFAULT '',
            role public.app_role NOT NULL DEFAULT 'cashier'::public.app_role,
            active boolean NOT NULL DEFAULT false,
            reset_token_hash text,
            reset_token_expires_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email);

        CREATE TABLE IF NOT EXISTS public.sessions (
            id text PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
            expires_at timestamptz NOT NULL,
            ip_hash text,
            user_agent text,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON public.sessions (user_id);
        CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON public.sessions (expires_at);

        CREATE TABLE IF NOT EXISTS public.company_settings (
            id integer PRIMARY KEY DEFAULT 1,
            name text NOT NULL DEFAULT '',
            address text NOT NULL DEFAULT '',
            phone text NOT NULL DEFAULT '',
            email text NOT NULL DEFAULT '',
            footer text NOT NULL DEFAULT '',
            currency text NOT NULL DEFAULT 'KES',
            number_prefix text NOT NULL DEFAULT 'RCP',
            logo_url text,
            stamp_url text,
            signature_url text,
            updated_at timestamptz NOT NULL DEFAULT now(),
            updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
        );

        ALTER TABLE public.company_settings
            ADD COLUMN IF NOT EXISTS registration_number text NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS tax_pin text NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS website text NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS invoice_prefix text NOT NULL DEFAULT 'INV',
            ADD COLUMN IF NOT EXISTS quote_prefix text NOT NULL DEFAULT 'QTN',
            ADD COLUMN IF NOT EXISTS payment_prefix text NOT NULL DEFAULT 'PAY';

        DO $$ BEGIN
            ALTER TABLE public.company_settings
                ADD CONSTRAINT chk_company_settings_singleton CHECK (id = 1);
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;

        CREATE TABLE IF NOT EXISTS public.receipt_sequences (
            prefix text NOT NULL,
            year integer NOT NULL,
            last_value bigint NOT NULL DEFAULT 0,
            PRIMARY KEY (prefix, year)
        );

        CREATE TABLE IF NOT EXISTS public.audit_logs (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
            action text NOT NULL,
            resource_type text,
            resource_id text,
            outcome text NOT NULL DEFAULT 'success',
            metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE public.audit_logs
            ADD COLUMN IF NOT EXISTS before_state jsonb,
            ADD COLUMN IF NOT EXISTS after_state jsonb;

        CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs (actor_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs (resource_type, resource_id);

        CREATE TABLE IF NOT EXISTS public.verify_attempts (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            client_key text NOT NULL,
            identifier text NOT NULL,
            result text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS verify_attempts_client_key_idx ON public.verify_attempts (client_key, created_at);
        CREATE INDEX IF NOT EXISTS verify_attempts_identifier_idx ON public.verify_attempts (identifier, created_at);
        """
    )

    # -------------------------------------------------------------------------
    # 1. Identity & RBAC Expansion (roles, permissions, user_roles, role_permissions)
    # -------------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.roles (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            code varchar(50) NOT NULL UNIQUE,
            name varchar(100) NOT NULL,
            description text NOT NULL DEFAULT '',
            is_system boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS public.permissions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            code varchar(100) NOT NULL UNIQUE,
            module varchar(50) NOT NULL,
            description text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_permissions_module ON public.permissions (module);

        CREATE TABLE IF NOT EXISTS public.user_roles (
            user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
            role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
            assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            assigned_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (user_id, role_id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles (role_id);

        CREATE TABLE IF NOT EXISTS public.role_permissions (
            role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
            permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
            granted_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (role_id, permission_id)
        );
        CREATE INDEX IF NOT EXISTS idx_role_permissions_perm ON public.role_permissions (permission_id);
        """
    )

    # -------------------------------------------------------------------------
    # 2. Business Settings, File Metadata, Templates, Numbering & Tax
    # -------------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.file_metadata (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            original_filename text NOT NULL,
            storage_key text NOT NULL UNIQUE,
            mime_type varchar(120) NOT NULL,
            file_size_bytes bigint NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
            checksum_sha256 varchar(64),
            access_classification varchar(30) NOT NULL DEFAULT 'authenticated'
                CHECK (access_classification IN ('public_branding', 'authenticated', 'confidential_client', 'immutable_financial_pdf')),
            entity_type varchar(50),
            entity_id uuid,
            version integer NOT NULL DEFAULT 1,
            uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_file_metadata_entity ON public.file_metadata (entity_type, entity_id);

        CREATE TABLE IF NOT EXISTS public.document_templates (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            document_type varchar(30) NOT NULL CHECK (document_type IN ('quote', 'invoice', 'receipt')),
            name varchar(100) NOT NULL,
            is_default boolean NOT NULL DEFAULT false,
            header_notes text NOT NULL DEFAULT '',
            default_terms text NOT NULL DEFAULT '',
            footer_notes text NOT NULL DEFAULT '',
            config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
            active boolean NOT NULL DEFAULT true,
            updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_document_templates_type ON public.document_templates (document_type, active);

        CREATE TABLE IF NOT EXISTS public.numbering_sequences (
            document_type varchar(30) NOT NULL
                CHECK (document_type IN ('quote', 'invoice', 'payment', 'receipt', 'refund', 'reconciliation')),
            prefix varchar(20) NOT NULL,
            scope_year integer NOT NULL CHECK (scope_year >= 2000 AND scope_year <= 2100),
            last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
            padding_length integer NOT NULL DEFAULT 6 CHECK (padding_length >= 3 AND padding_length <= 12),
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (document_type, prefix, scope_year)
        );

        CREATE TABLE IF NOT EXISTS public.tax_configurations (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            code varchar(30) NOT NULL UNIQUE,
            name varchar(100) NOT NULL,
            rate numeric(6, 4) NOT NULL DEFAULT 0.0000 CHECK (rate >= 0 AND rate <= 100),
            tax_type varchar(30) NOT NULL DEFAULT 'vat'
                CHECK (tax_type IN ('vat', 'withholding', 'excise', 'levy', 'exempt')),
            is_inclusive boolean NOT NULL DEFAULT false,
            applicable_to varchar(30) NOT NULL DEFAULT 'all'
                CHECK (applicable_to IN ('all', 'quote', 'invoice', 'receipt')),
            effective_from date NOT NULL DEFAULT CURRENT_DATE,
            effective_to date,
            active boolean NOT NULL DEFAULT true,
            created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT chk_tax_config_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
        );
        CREATE INDEX IF NOT EXISTS idx_tax_configurations_active ON public.tax_configurations (active, tax_type);
        """
    )

    # -------------------------------------------------------------------------
    # 3. CRM Domain (client_categories, clients, client_contacts, tags, interactions, documents)
    # -------------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.client_categories (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            code varchar(40) NOT NULL UNIQUE,
            name varchar(100) NOT NULL,
            description text NOT NULL DEFAULT '',
            active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS public.clients (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name text NOT NULL,
            phone text NOT NULL DEFAULT '',
            address text NOT NULL DEFAULT '',
            active boolean NOT NULL DEFAULT true,
            created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        ALTER TABLE public.clients
            ADD COLUMN IF NOT EXISTS client_code varchar(30) UNIQUE,
            ADD COLUMN IF NOT EXISTS client_type varchar(20) NOT NULL DEFAULT 'individual',
            ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS billing_address text NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS industry varchar(100) NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS tax_pin varchar(40) NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.client_categories(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active',
            ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

        DO $$ BEGIN
            ALTER TABLE public.clients
                ADD CONSTRAINT chk_clients_type CHECK (client_type IN ('individual', 'corporate'));
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;

        DO $$ BEGIN
            ALTER TABLE public.clients
                ADD CONSTRAINT chk_clients_status CHECK (status IN ('active', 'inactive', 'archived'));
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;

        CREATE INDEX IF NOT EXISTS clients_name_idx ON public.clients (name);
        CREATE INDEX IF NOT EXISTS clients_phone_idx ON public.clients (phone);
        CREATE INDEX IF NOT EXISTS idx_clients_email ON public.clients (email);
        CREATE INDEX IF NOT EXISTS idx_clients_category ON public.clients (category_id);
        CREATE INDEX IF NOT EXISTS idx_clients_status ON public.clients (status);

        CREATE TABLE IF NOT EXISTS public.client_contacts (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
            full_name varchar(150) NOT NULL,
            job_title varchar(100) NOT NULL DEFAULT '',
            email text NOT NULL DEFAULT '',
            phone varchar(50) NOT NULL DEFAULT '',
            is_primary boolean NOT NULL DEFAULT false,
            active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_client_contacts_client ON public.client_contacts (client_id);

        CREATE TABLE IF NOT EXISTS public.client_tags (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name varchar(60) NOT NULL UNIQUE,
            color_hex varchar(7) NOT NULL DEFAULT '#5848D6',
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS public.client_tag_assignments (
            client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
            tag_id uuid NOT NULL REFERENCES public.client_tags(id) ON DELETE CASCADE,
            assigned_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (client_id, tag_id)
        );
        CREATE INDEX IF NOT EXISTS idx_client_tag_assignments_tag ON public.client_tag_assignments (tag_id);

        CREATE TABLE IF NOT EXISTS public.client_interactions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
            contact_id uuid REFERENCES public.client_contacts(id) ON DELETE SET NULL,
            interaction_type varchar(30) NOT NULL DEFAULT 'note'
                CHECK (interaction_type IN ('call', 'meeting', 'email', 'follow_up', 'requirement', 'note', 'other')),
            subject varchar(200) NOT NULL,
            summary text NOT NULL DEFAULT '',
            occurred_at timestamptz NOT NULL DEFAULT now(),
            next_follow_up_at timestamptz,
            logged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_client_interactions_client_date
            ON public.client_interactions (client_id, occurred_at);

        CREATE TABLE IF NOT EXISTS public.client_documents (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
            file_id uuid NOT NULL REFERENCES public.file_metadata(id) ON DELETE RESTRICT,
            document_category varchar(50) NOT NULL DEFAULT 'contract'
                CHECK (document_category IN ('contract', 'proposal', 'sla', 'kyc', 'tax_exemption', 'other')),
            title varchar(200) NOT NULL,
            notes text NOT NULL DEFAULT '',
            uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_client_documents_client ON public.client_documents (client_id);
        """
    )

    # -------------------------------------------------------------------------
    # 4. Quotations & Proposals (quotes, quote_items)
    # -------------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.quotes (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            quote_number varchar(40) UNIQUE,
            client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
            status varchar(20) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'sent', 'approved', 'rejected', 'expired', 'converted', 'cancelled')),
            issue_date date NOT NULL DEFAULT CURRENT_DATE,
            expiry_date date,
            currency varchar(3) NOT NULL DEFAULT 'KES',
            subtotal numeric(14, 2) NOT NULL DEFAULT 0.00,
            discount_total numeric(14, 2) NOT NULL DEFAULT 0.00,
            tax_total numeric(14, 2) NOT NULL DEFAULT 0.00,
            total numeric(14, 2) NOT NULL DEFAULT 0.00,
            terms text NOT NULL DEFAULT '',
            notes text NOT NULL DEFAULT '',
            company_snapshot jsonb,
            client_snapshot jsonb,
            created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
            finalized_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            finalized_at timestamptz,
            converted_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT chk_quotes_amounts CHECK (subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0 AND total >= 0),
            CONSTRAINT chk_quotes_dates CHECK (expiry_date IS NULL OR expiry_date >= issue_date)
        );
        CREATE INDEX IF NOT EXISTS idx_quotes_client_status ON public.quotes (client_id, status);
        CREATE INDEX IF NOT EXISTS idx_quotes_issue_date ON public.quotes (issue_date);

        CREATE TABLE IF NOT EXISTS public.quote_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
            position integer NOT NULL DEFAULT 0,
            description text NOT NULL,
            quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
            unit_price numeric(14, 2) NOT NULL,
            discount_amount numeric(14, 2) NOT NULL DEFAULT 0.00,
            tax_config_id uuid REFERENCES public.tax_configurations(id) ON DELETE SET NULL,
            tax_rate numeric(6, 4) NOT NULL DEFAULT 0.0000,
            tax_amount numeric(14, 2) NOT NULL DEFAULT 0.00,
            line_subtotal numeric(14, 2) NOT NULL,
            line_total numeric(14, 2) NOT NULL,
            CONSTRAINT chk_quote_items_prices CHECK (unit_price >= 0 AND discount_amount >= 0 AND tax_rate >= 0 AND tax_amount >= 0),
            CONSTRAINT chk_quote_items_totals CHECK (line_subtotal >= 0 AND line_total >= 0)
        );
        CREATE INDEX IF NOT EXISTS idx_quote_items_quote_pos ON public.quote_items (quote_id, position);
        """
    )

    # -------------------------------------------------------------------------
    # 5. Invoicing & Accounts Receivable (invoices, invoice_items)
    # -------------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.invoices (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_number varchar(40) UNIQUE,
            client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
            quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
            status varchar(20) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled', 'void')),
            issue_date date NOT NULL DEFAULT CURRENT_DATE,
            due_date date,
            currency varchar(3) NOT NULL DEFAULT 'KES',
            subtotal numeric(14, 2) NOT NULL DEFAULT 0.00,
            discount_total numeric(14, 2) NOT NULL DEFAULT 0.00,
            tax_total numeric(14, 2) NOT NULL DEFAULT 0.00,
            total numeric(14, 2) NOT NULL DEFAULT 0.00,
            amount_allocated numeric(14, 2) NOT NULL DEFAULT 0.00,
            balance_due numeric(14, 2) NOT NULL DEFAULT 0.00,
            terms text NOT NULL DEFAULT '',
            notes text NOT NULL DEFAULT '',
            company_snapshot jsonb,
            client_snapshot jsonb,
            created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
            issued_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            finalized_at timestamptz,
            cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            cancelled_at timestamptz,
            cancel_reason text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT chk_invoices_totals_non_negative
                CHECK (subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0 AND total >= 0),
            CONSTRAINT chk_invoices_allocated_bounds
                CHECK (amount_allocated >= 0 AND amount_allocated <= total),
            CONSTRAINT chk_invoices_balance_bounds
                CHECK (balance_due >= 0 AND balance_due <= total),
            CONSTRAINT chk_invoices_balance_equation
                CHECK (status IN ('cancelled', 'void') OR (amount_allocated + balance_due = total)),
            CONSTRAINT chk_invoices_dates
                CHECK (due_date IS NULL OR due_date >= issue_date)
        );
        CREATE INDEX IF NOT EXISTS idx_invoices_client_status ON public.invoices (client_id, status, due_date);
        CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON public.invoices (issue_date);
        CREATE INDEX IF NOT EXISTS idx_invoices_quote_id ON public.invoices (quote_id);

        CREATE TABLE IF NOT EXISTS public.invoice_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
            position integer NOT NULL DEFAULT 0,
            description text NOT NULL,
            quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
            unit_price numeric(14, 2) NOT NULL,
            discount_amount numeric(14, 2) NOT NULL DEFAULT 0.00,
            tax_config_id uuid REFERENCES public.tax_configurations(id) ON DELETE SET NULL,
            tax_rate numeric(6, 4) NOT NULL DEFAULT 0.0000,
            tax_amount numeric(14, 2) NOT NULL DEFAULT 0.00,
            line_subtotal numeric(14, 2) NOT NULL,
            line_total numeric(14, 2) NOT NULL,
            CONSTRAINT chk_invoice_items_prices
                CHECK (unit_price >= 0 AND discount_amount >= 0 AND tax_rate >= 0 AND tax_amount >= 0),
            CONSTRAINT chk_invoice_items_totals
                CHECK (line_subtotal >= 0 AND line_total >= 0)
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_pos ON public.invoice_items (invoice_id, position);
        """
    )

    # -------------------------------------------------------------------------
    # 6. Payments, Allocations & Refunds (payments, payment_allocations, payment_refunds)
    # -------------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.payments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            payment_reference varchar(40) NOT NULL UNIQUE,
            client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
            status varchar(25) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'confirmed', 'failed', 'refunded', 'partially_refunded', 'reversed')),
            payment_method varchar(30) NOT NULL DEFAULT 'mpesa'
                CHECK (payment_method IN ('cash', 'mpesa', 'bank_transfer', 'card', 'cheque', 'other')),
            external_reference varchar(100),
            payment_date timestamptz NOT NULL DEFAULT now(),
            currency varchar(3) NOT NULL DEFAULT 'KES',
            amount numeric(14, 2) NOT NULL CHECK (amount > 0),
            amount_allocated numeric(14, 2) NOT NULL DEFAULT 0.00,
            amount_refunded numeric(14, 2) NOT NULL DEFAULT 0.00,
            amount_receipted numeric(14, 2) NOT NULL DEFAULT 0.00,
            unallocated_amount numeric(14, 2) NOT NULL DEFAULT 0.00,
            notes text NOT NULL DEFAULT '',
            recorded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
            confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            confirmed_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT chk_payments_subamounts_non_negative
                CHECK (amount_allocated >= 0 AND amount_refunded >= 0 AND amount_receipted >= 0 AND unallocated_amount >= 0),
            CONSTRAINT chk_payments_allocation_bounds
                CHECK (amount_allocated + amount_refunded <= amount),
            CONSTRAINT chk_payments_receipt_bounds
                CHECK (amount_receipted <= amount - amount_refunded),
            CONSTRAINT chk_payments_unallocated_sync
                CHECK (unallocated_amount = amount - amount_allocated - amount_refunded)
        );
        CREATE INDEX IF NOT EXISTS idx_payments_client_status_date ON public.payments (client_id, status, payment_date);
        CREATE INDEX IF NOT EXISTS idx_payments_external_ref ON public.payments (payment_method, external_reference);

        CREATE TABLE IF NOT EXISTS public.payment_allocations (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
            invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
            amount numeric(14, 2) NOT NULL CHECK (amount > 0),
            status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
            notes text NOT NULL DEFAULT '',
            allocated_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
            allocated_at timestamptz NOT NULL DEFAULT now(),
            reversed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            reversed_at timestamptz,
            reversal_reason text
        );
        CREATE INDEX IF NOT EXISTS idx_payment_alloc_invoice ON public.payment_allocations (invoice_id, status);
        CREATE INDEX IF NOT EXISTS idx_payment_alloc_payment ON public.payment_allocations (payment_id, status);

        CREATE TABLE IF NOT EXISTS public.payment_refunds (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            refund_reference varchar(40) NOT NULL UNIQUE,
            payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
            amount numeric(14, 2) NOT NULL CHECK (amount > 0),
            reason text NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'completed'
                CHECK (status IN ('pending', 'completed', 'failed')),
            external_reference varchar(100),
            processed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
            refunded_at timestamptz NOT NULL DEFAULT now(),
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment ON public.payment_refunds (payment_id, status);
        """
    )

    # -------------------------------------------------------------------------
    # 7. Receipts & Payment-Receipt Allocations
    # -------------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.receipts (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            status public.receipt_status NOT NULL DEFAULT 'draft'::public.receipt_status,
            receipt_number text UNIQUE,
            verification_code text UNIQUE,
            client_id uuid NOT NULL REFERENCES public.clients(id),
            customer_name text NOT NULL,
            customer_phone text NOT NULL DEFAULT '',
            customer_address text NOT NULL DEFAULT '',
            notes text NOT NULL DEFAULT '',
            currency text NOT NULL DEFAULT 'KES',
            total numeric(14, 2) NOT NULL DEFAULT 0.00,
            payment_status text NOT NULL DEFAULT 'paid',
            amount_paid numeric(14, 2) NOT NULL DEFAULT 0.00,
            balance_due numeric(14, 2) NOT NULL DEFAULT 0.00,
            payment_method text NOT NULL DEFAULT 'M-Pesa',
            company_snapshot jsonb,
            created_by uuid NOT NULL REFERENCES public.users(id),
            issued_by uuid REFERENCES public.users(id),
            issued_by_name text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            finalized_at timestamptz,
            cancelled_at timestamptz,
            cancelled_by uuid REFERENCES public.users(id),
            cancel_reason text,
            print_count integer NOT NULL DEFAULT 0
        );

        ALTER TABLE public.receipts
            ADD COLUMN IF NOT EXISTS primary_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

        DO $$ BEGIN
            ALTER TABLE public.receipts
                ADD CONSTRAINT chk_receipts_payment_status
                CHECK (payment_status IN ('paid', 'half_paid', 'unpaid', 'in_progress', 'failed', 'overdue', 'refunded', 'disputed'));
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;

        DO $$ BEGIN
            ALTER TABLE public.receipts
                ADD CONSTRAINT chk_receipts_amounts_non_negative
                CHECK (total >= 0 AND amount_paid >= 0 AND balance_due >= 0);
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END $$;

        CREATE INDEX IF NOT EXISTS receipts_status_finalized_idx ON public.receipts (status, finalized_at);
        CREATE INDEX IF NOT EXISTS receipts_client_id_idx ON public.receipts (client_id);
        CREATE INDEX IF NOT EXISTS receipts_created_at_idx ON public.receipts (created_at);
        CREATE INDEX IF NOT EXISTS idx_receipts_primary_payment ON public.receipts (primary_payment_id);

        CREATE TABLE IF NOT EXISTS public.receipt_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
            position integer NOT NULL,
            description text NOT NULL,
            quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
            unit_price numeric(14, 2) NOT NULL CHECK (unit_price >= 0),
            line_total numeric(14, 2) NOT NULL CHECK (line_total >= 0)
        );
        CREATE INDEX IF NOT EXISTS receipt_items_receipt_pos_idx ON public.receipt_items (receipt_id, position);

        CREATE TABLE IF NOT EXISTS public.payment_receipt_allocations (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
            receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
            amount_acknowledged numeric(14, 2) NOT NULL CHECK (amount_acknowledged > 0),
            status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_receipt_active
            ON public.payment_receipt_allocations (payment_id, receipt_id)
            WHERE status = 'active';
        CREATE INDEX IF NOT EXISTS idx_pra_receipt_id ON public.payment_receipt_allocations (receipt_id);
        """
    )

    # -------------------------------------------------------------------------
    # 8. Communications (notification_templates, email_logs, sms_logs)
    # -------------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.notification_templates (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            code varchar(50) NOT NULL UNIQUE,
            channel varchar(15) NOT NULL CHECK (channel IN ('email', 'sms')),
            name varchar(100) NOT NULL,
            subject_template text NOT NULL DEFAULT '',
            body_template text NOT NULL,
            active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS public.email_logs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
            template_id uuid REFERENCES public.notification_templates(id) ON DELETE SET NULL,
            recipient text NOT NULL,
            subject text NOT NULL DEFAULT '',
            message_type varchar(40) NOT NULL,
            related_document_type varchar(30),
            related_document_id uuid,
            provider varchar(40) NOT NULL DEFAULT 'smtp',
            provider_message_id varchar(120),
            status varchar(20) NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'bounced')),
            attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
            sent_at timestamptz,
            delivered_at timestamptz,
            failure_reason text,
            metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
            triggered_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_email_logs_client_date ON public.email_logs (client_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_email_logs_document ON public.email_logs (related_document_type, related_document_id);

        CREATE TABLE IF NOT EXISTS public.sms_logs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
            template_id uuid REFERENCES public.notification_templates(id) ON DELETE SET NULL,
            recipient varchar(50) NOT NULL,
            message_type varchar(40) NOT NULL,
            related_document_type varchar(30),
            related_document_id uuid,
            provider varchar(40) NOT NULL DEFAULT 'africastalking',
            provider_message_id varchar(120),
            status varchar(20) NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'bounced')),
            attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
            sent_at timestamptz,
            delivered_at timestamptz,
            failure_reason text,
            metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
            triggered_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_sms_logs_client_date ON public.sms_logs (client_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_sms_logs_document ON public.sms_logs (related_document_type, related_document_id);
        """
    )

    # -------------------------------------------------------------------------
    # 9. Transaction Reconciliation (batches, records, matches)
    # -------------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.reconciliation_batches (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            batch_number varchar(40) NOT NULL UNIQUE,
            source_type varchar(30) NOT NULL
                CHECK (source_type IN ('mpesa_statement', 'bank_statement', 'card_settlement', 'manual_import')),
            account_identifier varchar(100) NOT NULL DEFAULT '',
            period_start date,
            period_end date,
            status varchar(20) NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in_review', 'completed', 'archived')),
            total_records integer NOT NULL DEFAULT 0 CHECK (total_records >= 0),
            matched_records integer NOT NULL DEFAULT 0 CHECK (matched_records >= 0),
            unmatched_records integer NOT NULL DEFAULT 0 CHECK (unmatched_records >= 0),
            imported_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
            created_at timestamptz NOT NULL DEFAULT now(),
            completed_at timestamptz
        );

        CREATE TABLE IF NOT EXISTS public.reconciliation_records (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            batch_id uuid NOT NULL REFERENCES public.reconciliation_batches(id) ON DELETE CASCADE,
            external_tx_id varchar(100) NOT NULL,
            payment_method varchar(30) NOT NULL DEFAULT 'mpesa',
            transaction_date timestamptz NOT NULL,
            amount numeric(14, 2) NOT NULL CHECK (amount > 0),
            currency varchar(3) NOT NULL DEFAULT 'KES',
            payer_name text NOT NULL DEFAULT '',
            payer_phone varchar(50) NOT NULL DEFAULT '',
            description text NOT NULL DEFAULT '',
            match_status varchar(25) NOT NULL DEFAULT 'unmatched'
                CHECK (match_status IN ('unmatched', 'suggested', 'matched', 'rejected', 'ignored')),
            raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
            reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            reviewed_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_recon_external_source UNIQUE (payment_method, external_tx_id)
        );
        CREATE INDEX IF NOT EXISTS idx_recon_records_batch_status ON public.reconciliation_records (batch_id, match_status);
        CREATE INDEX IF NOT EXISTS idx_recon_records_tx_date ON public.reconciliation_records (transaction_date);

        CREATE TABLE IF NOT EXISTS public.reconciliation_matches (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            reconciliation_record_id uuid NOT NULL REFERENCES public.reconciliation_records(id) ON DELETE CASCADE,
            payment_id uuid REFERENCES public.payments(id) ON DELETE RESTRICT,
            invoice_id uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
            matched_amount numeric(14, 2) NOT NULL CHECK (matched_amount > 0),
            confidence_score numeric(5, 2) NOT NULL DEFAULT 100.00 CHECK (confidence_score >= 0 AND confidence_score <= 100),
            match_state varchar(20) NOT NULL DEFAULT 'suggested'
                CHECK (match_state IN ('suggested', 'confirmed', 'rejected', 'unmatched')),
            notes text NOT NULL DEFAULT '',
            matched_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
            matched_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_record_confirmed
            ON public.reconciliation_matches (reconciliation_record_id)
            WHERE match_state = 'confirmed';
        CREATE INDEX IF NOT EXISTS idx_recon_matches_payment ON public.reconciliation_matches (payment_id);
        """
    )

    # -------------------------------------------------------------------------
    # 10. Database-Level Financial Integrity Triggers & Authoritative Ledger View
    # -------------------------------------------------------------------------
    op.execute(
        """
        -- 10.1 Trigger: Enforce Payment Allocation Integrity & Synchronize Invoice / Payment Balances
        CREATE OR REPLACE FUNCTION public.fn_sync_payment_allocation()
        RETURNS TRIGGER AS $$
        DECLARE
            v_payment RECORD;
            v_invoice RECORD;
            v_total_pay_alloc numeric(14, 2);
            v_total_inv_alloc numeric(14, 2);
            v_new_inv_status varchar(20);
        BEGIN
            SELECT * INTO v_payment FROM public.payments WHERE id = COALESCE(NEW.payment_id, OLD.payment_id) FOR UPDATE;
            SELECT * INTO v_invoice FROM public.invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id) FOR UPDATE;

            IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status = 'active') THEN
                IF v_payment.status NOT IN ('confirmed', 'partially_refunded') THEN
                    RAISE EXCEPTION 'Cannot allocate unconfirmed or reversed payment % (status=%)', v_payment.payment_reference, v_payment.status;
                END IF;
                IF v_invoice.status IN ('draft', 'cancelled', 'void') THEN
                    RAISE EXCEPTION 'Cannot allocate payment to invoice % with status %', v_invoice.invoice_number, v_invoice.status;
                END IF;
                IF v_payment.currency <> v_invoice.currency THEN
                    RAISE EXCEPTION 'Currency mismatch between payment (%) and invoice (%)', v_payment.currency, v_invoice.currency;
                END IF;
            END IF;

            SELECT COALESCE(SUM(amount), 0.00) INTO v_total_pay_alloc
            FROM public.payment_allocations
            WHERE payment_id = v_payment.id AND status = 'active';

            IF v_total_pay_alloc + v_payment.amount_refunded > v_payment.amount THEN
                RAISE EXCEPTION 'Over-allocation of payment %: allocated (%) + refunded (%) exceeds payment amount (%)',
                    v_payment.payment_reference, v_total_pay_alloc, v_payment.amount_refunded, v_payment.amount;
            END IF;

            SELECT COALESCE(SUM(amount), 0.00) INTO v_total_inv_alloc
            FROM public.payment_allocations
            WHERE invoice_id = v_invoice.id AND status = 'active';

            IF v_total_inv_alloc > v_invoice.total THEN
                RAISE EXCEPTION 'Over-allocation of invoice %: allocated (%) exceeds invoice total (%)',
                    v_invoice.invoice_number, v_total_inv_alloc, v_invoice.total;
            END IF;

            UPDATE public.payments
            SET amount_allocated = v_total_pay_alloc,
                unallocated_amount = amount - v_total_pay_alloc - amount_refunded,
                updated_at = now()
            WHERE id = v_payment.id;

            IF v_total_inv_alloc = v_invoice.total AND v_invoice.total > 0 THEN
                v_new_inv_status := 'paid';
            ELSIF v_total_inv_alloc > 0 THEN
                v_new_inv_status := 'partially_paid';
            ELSE
                v_new_inv_status := CASE WHEN v_invoice.status IN ('paid', 'partially_paid') THEN 'issued' ELSE v_invoice.status END;
            END IF;

            UPDATE public.invoices
            SET amount_allocated = v_total_inv_alloc,
                balance_due = total - v_total_inv_alloc,
                status = v_new_inv_status,
                updated_at = now()
            WHERE id = v_invoice.id;

            RETURN COALESCE(NEW, OLD);
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_sync_payment_allocation ON public.payment_allocations;
        CREATE TRIGGER trg_sync_payment_allocation
        AFTER INSERT OR UPDATE OR DELETE ON public.payment_allocations
        FOR EACH ROW EXECUTE FUNCTION public.fn_sync_payment_allocation();

        -- 10.2 Trigger: Enforce Payment-to-Receipt Allocation & Prevent Double-Receipting
        CREATE OR REPLACE FUNCTION public.fn_sync_payment_receipt_allocation()
        RETURNS TRIGGER AS $$
        DECLARE
            v_payment RECORD;
            v_total_receipted numeric(14, 2);
        BEGIN
            SELECT * INTO v_payment FROM public.payments WHERE id = COALESCE(NEW.payment_id, OLD.payment_id) FOR UPDATE;

            IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status = 'active') THEN
                IF v_payment.status NOT IN ('confirmed', 'partially_refunded') THEN
                    RAISE EXCEPTION 'Cannot acknowledge unconfirmed payment % on a finalized receipt', v_payment.payment_reference;
                END IF;
            END IF;

            SELECT COALESCE(SUM(amount_acknowledged), 0.00) INTO v_total_receipted
            FROM public.payment_receipt_allocations
            WHERE payment_id = v_payment.id AND status = 'active';

            IF v_total_receipted > (v_payment.amount - v_payment.amount_refunded) THEN
                RAISE EXCEPTION 'Double-receipting prevented for payment %: total receipted (%) exceeds net confirmed payment (%)',
                    v_payment.payment_reference, v_total_receipted, (v_payment.amount - v_payment.amount_refunded);
            END IF;

            UPDATE public.payments
            SET amount_receipted = v_total_receipted,
                updated_at = now()
            WHERE id = v_payment.id;

            RETURN COALESCE(NEW, OLD);
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_sync_payment_receipt_allocation ON public.payment_receipt_allocations;
        CREATE TRIGGER trg_sync_payment_receipt_allocation
        AFTER INSERT OR UPDATE OR DELETE ON public.payment_receipt_allocations
        FOR EACH ROW EXECUTE FUNCTION public.fn_sync_payment_receipt_allocation();

        -- 10.3 Trigger: Enforce Payment Refunds & Preserve Historical Payment Record
        CREATE OR REPLACE FUNCTION public.fn_sync_payment_refund()
        RETURNS TRIGGER AS $$
        DECLARE
            v_payment RECORD;
            v_total_refunded numeric(14, 2);
            v_new_status varchar(25);
        BEGIN
            SELECT * INTO v_payment FROM public.payments WHERE id = COALESCE(NEW.payment_id, OLD.payment_id) FOR UPDATE;

            SELECT COALESCE(SUM(amount), 0.00) INTO v_total_refunded
            FROM public.payment_refunds
            WHERE payment_id = v_payment.id AND status = 'completed';

            IF v_total_refunded > v_payment.amount THEN
                RAISE EXCEPTION 'Refund total (%) cannot exceed original payment amount (%)', v_total_refunded, v_payment.amount;
            END IF;

            IF v_total_refunded + v_payment.amount_allocated > v_payment.amount THEN
                RAISE EXCEPTION 'Refund (%) exceeds unallocated balance of payment %; reverse invoice allocations first',
                    v_total_refunded, v_payment.payment_reference;
            END IF;

            IF v_total_refunded = v_payment.amount THEN
                v_new_status := 'refunded';
            ELSIF v_total_refunded > 0 THEN
                v_new_status := 'partially_refunded';
            ELSE
                v_new_status := v_payment.status;
            END IF;

            UPDATE public.payments
            SET amount_refunded = v_total_refunded,
                unallocated_amount = amount - amount_allocated - v_total_refunded,
                status = v_new_status,
                updated_at = now()
            WHERE id = v_payment.id;

            RETURN COALESCE(NEW, OLD);
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_sync_payment_refund ON public.payment_refunds;
        CREATE TRIGGER trg_sync_payment_refund
        AFTER INSERT OR UPDATE OR DELETE ON public.payment_refunds
        FOR EACH ROW EXECUTE FUNCTION public.fn_sync_payment_refund();

        -- 10.4 Authoritative Client Ledger Derivation View (Never Manually Editable)
        CREATE OR REPLACE VIEW public.v_client_ledger_summary AS
        SELECT
            c.id AS client_id,
            c.name AS client_name,
            c.client_type,
            c.status AS client_status,
            COALESCE(inv.total_invoiced, 0.00)::numeric(14, 2) AS total_invoiced,
            COALESCE(inv.total_invoice_allocated, 0.00)::numeric(14, 2) AS total_allocated_to_invoices,
            COALESCE(inv.outstanding_invoice_balance, 0.00)::numeric(14, 2) AS outstanding_invoice_balance,
            COALESCE(pay.gross_confirmed_payments, 0.00)::numeric(14, 2) AS total_confirmed_payments,
            COALESCE(pay.total_refunded, 0.00)::numeric(14, 2) AS total_refunds,
            COALESCE(pay.net_collections, 0.00)::numeric(14, 2) AS net_collections,
            COALESCE(pay.unallocated_credit, 0.00)::numeric(14, 2) AS unallocated_client_credit,
            COALESCE(rcp.total_receipted, 0.00)::numeric(14, 2) AS total_receipted
        FROM public.clients c
        LEFT JOIN (
            SELECT
                client_id,
                SUM(total) AS total_invoiced,
                SUM(amount_allocated) AS total_invoice_allocated,
                SUM(balance_due) AS outstanding_invoice_balance
            FROM public.invoices
            WHERE status IN ('issued', 'partially_paid', 'paid', 'overdue')
            GROUP BY client_id
        ) inv ON inv.client_id = c.id
        LEFT JOIN (
            SELECT
                client_id,
                SUM(amount) AS gross_confirmed_payments,
                SUM(amount_refunded) AS total_refunded,
                SUM(amount - amount_refunded) AS net_collections,
                SUM(unallocated_amount) AS unallocated_credit
            FROM public.payments
            WHERE status IN ('confirmed', 'partially_refunded', 'refunded')
            GROUP BY client_id
        ) pay ON pay.client_id = c.id
        LEFT JOIN (
            SELECT
                client_id,
                SUM(amount_paid) AS total_receipted
            FROM public.receipts
            WHERE status = 'finalized'
            GROUP BY client_id
        ) rcp ON rcp.client_id = c.id;
        """
    )

    # -------------------------------------------------------------------------
    # 11. Enable Row-Level Security (RLS) on All 37 Public Tables
    # -------------------------------------------------------------------------
    op.execute(
        """
        DO $$
        DECLARE
            t text;
        BEGIN
            FOR t IN
                SELECT tablename FROM pg_tables WHERE schemaname = 'public'
            LOOP
                EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
            END LOOP;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP VIEW IF EXISTS public.v_client_ledger_summary;
        DROP TRIGGER IF EXISTS trg_sync_payment_refund ON public.payment_refunds;
        DROP FUNCTION IF EXISTS public.fn_sync_payment_refund();
        DROP TRIGGER IF EXISTS trg_sync_payment_receipt_allocation ON public.payment_receipt_allocations;
        DROP FUNCTION IF EXISTS public.fn_sync_payment_receipt_allocation();
        DROP TRIGGER IF EXISTS trg_sync_payment_allocation ON public.payment_allocations;
        DROP FUNCTION IF EXISTS public.fn_sync_payment_allocation();

        DROP TABLE IF EXISTS public.reconciliation_matches CASCADE;
        DROP TABLE IF EXISTS public.reconciliation_records CASCADE;
        DROP TABLE IF EXISTS public.reconciliation_batches CASCADE;
        DROP TABLE IF EXISTS public.sms_logs CASCADE;
        DROP TABLE IF EXISTS public.email_logs CASCADE;
        DROP TABLE IF EXISTS public.notification_templates CASCADE;
        DROP TABLE IF EXISTS public.payment_receipt_allocations CASCADE;
        DROP TABLE IF EXISTS public.payment_refunds CASCADE;
        DROP TABLE IF EXISTS public.payment_allocations CASCADE;
        DROP TABLE IF EXISTS public.payments CASCADE;
        DROP TABLE IF EXISTS public.invoice_items CASCADE;
        DROP TABLE IF EXISTS public.invoices CASCADE;
        DROP TABLE IF EXISTS public.quote_items CASCADE;
        DROP TABLE IF EXISTS public.quotes CASCADE;
        DROP TABLE IF EXISTS public.client_documents CASCADE;
        DROP TABLE IF EXISTS public.client_interactions CASCADE;
        DROP TABLE IF EXISTS public.client_tag_assignments CASCADE;
        DROP TABLE IF EXISTS public.client_tags CASCADE;
        DROP TABLE IF EXISTS public.client_contacts CASCADE;
        DROP TABLE IF EXISTS public.client_categories CASCADE;
        DROP TABLE IF EXISTS public.tax_configurations CASCADE;
        DROP TABLE IF EXISTS public.numbering_sequences CASCADE;
        DROP TABLE IF EXISTS public.document_templates CASCADE;
        DROP TABLE IF EXISTS public.file_metadata CASCADE;
        DROP TABLE IF EXISTS public.role_permissions CASCADE;
        DROP TABLE IF EXISTS public.user_roles CASCADE;
        DROP TABLE IF EXISTS public.permissions CASCADE;
        DROP TABLE IF EXISTS public.roles CASCADE;
        """
    )
