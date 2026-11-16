"""MP-17 Security Hardening: Immutable Audit Logs Trigger

Revision ID: 20261116_0002
Revises: 20261112_0001
Create Date: 2026-11-16 16:00:00

Enforces database-level immutability on `public.audit_logs` so audit records
cannot be updated or deleted by ordinary application queries (MP-17 Section 14 / SEC-06).
"""

from typing import Sequence, Union
from alembic import op

revision: str = "20261116_0002"
down_revision: Union[str, None] = "20261112_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.fn_prevent_audit_log_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'Security Violation: public.audit_logs is append-only and cannot be modified or deleted (% attempted on id=%)',
                TG_OP, OLD.id;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_protect_audit_logs_immutable ON public.audit_logs;
        CREATE TRIGGER trg_protect_audit_logs_immutable
        BEFORE UPDATE OR DELETE ON public.audit_logs
        FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_audit_log_mutation();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_protect_audit_logs_immutable ON public.audit_logs;
        DROP FUNCTION IF EXISTS public.fn_prevent_audit_log_mutation();
        """
    )
