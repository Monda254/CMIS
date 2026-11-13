"""
Canonical IBMS Domain Model Registry (37 tables across 10 domain modules).
"""

from fastapi_service.database import Base
from fastapi_service.models.communications import (
    EmailLog,
    NotificationTemplate,
    SmsLog,
)
from fastapi_service.models.crm import (
    Client,
    ClientCategory,
    ClientContact,
    ClientDocument,
    ClientInteraction,
    ClientTag,
    ClientTagAssignment,
)
from fastapi_service.models.identity import (
    AuditLog,
    Permission,
    Role,
    RolePermission,
    SessionRecord,
    User,
    UserRole,
)
from fastapi_service.models.invoicing import Invoice, InvoiceItem
from fastapi_service.models.payments import (
    Payment,
    PaymentAllocation,
    PaymentRefund,
)
from fastapi_service.models.quotations import Quote, QuoteItem
from fastapi_service.models.receipts import (
    PaymentReceiptAllocation,
    Receipt,
    ReceiptItem,
    VerifyAttempt,
)
from fastapi_service.models.reconciliation import (
    ReconciliationBatch,
    ReconciliationMatch,
    ReconciliationRecord,
)
from fastapi_service.models.settings import (
    CompanySettings,
    DocumentTemplate,
    FileMetadata,
    NumberingSequence,
    ReceiptSequence,
    TaxConfiguration,
)

__all__ = [
    "Base",
    "User",
    "Role",
    "Permission",
    "UserRole",
    "RolePermission",
    "SessionRecord",
    "AuditLog",
    "CompanySettings",
    "FileMetadata",
    "DocumentTemplate",
    "NumberingSequence",
    "ReceiptSequence",
    "TaxConfiguration",
    "ClientCategory",
    "Client",
    "ClientContact",
    "ClientTag",
    "ClientTagAssignment",
    "ClientInteraction",
    "ClientDocument",
    "Quote",
    "QuoteItem",
    "Invoice",
    "InvoiceItem",
    "Payment",
    "PaymentAllocation",
    "PaymentRefund",
    "Receipt",
    "ReceiptItem",
    "PaymentReceiptAllocation",
    "VerifyAttempt",
    "NotificationTemplate",
    "EmailLog",
    "SmsLog",
    "ReconciliationBatch",
    "ReconciliationRecord",
    "ReconciliationMatch",
]
