"""
Company Settings, Document Templates & Secure File Uploads/Downloads Module (Sections 10.2 & 12).
Enforces strict file type, magic-byte/extension, size, path-traversal, and access-classification protections.
"""

from __future__ import annotations

import base64
import hashlib
import re
import uuid
from datetime import datetime
from email.parser import BytesParser
from email.policy import default as email_default_policy
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from fastapi_service.core.config import settings
from fastapi_service.core.exceptions import (
    AuthorizationError,
    BadRequestError,
    NotFoundError,
)
from fastapi_service.core.pagination import ApiResponse
from fastapi_service.core.permissions import (
    AuthenticatedUser,
    require_admin,
    require_permission,
)
from fastapi_service.core.security import record_audit_log
from fastapi_service.database import get_db
from fastapi_service.models.settings import (
    CompanySettings,
    DocumentTemplate,
    FileMetadata,
)
from fastapi_service.services.financial_service import ensure_company_settings

router = APIRouter(prefix="/company", tags=["Company Settings & Files"])

ALLOWED_MIME_EXTENSIONS: dict[str, set[str]] = {
    "image/png": {".png"},
    "image/jpeg": {".jpg", ".jpeg"},
    "image/webp": {".webp"},
    "application/pdf": {".pdf"},
    "text/csv": {".csv"},
    "text/plain": {".txt", ".csv"},
}

SAFE_FILENAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")


class CompanySettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    registration_number: str
    tax_pin: str
    address: str
    phone: str
    email: str
    website: str
    footer: str
    currency: str
    number_prefix: str
    invoice_prefix: str
    quote_prefix: str
    payment_prefix: str
    logo_url: str | None
    stamp_url: str | None
    signature_url: str | None
    updated_at: datetime


class CompanySettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=200)
    registration_number: str | None = Field(default=None, max_length=100)
    tax_pin: str | None = Field(default=None, max_length=60)
    address: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=60)
    email: str | None = Field(default=None, max_length=150)
    website: str | None = Field(default=None, max_length=200)
    footer: str | None = Field(default=None, max_length=1000)
    currency: str | None = Field(default=None, min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    number_prefix: str | None = Field(default=None, min_length=2, max_length=12, pattern=r"^[A-Z0-9]+$")
    invoice_prefix: str | None = Field(default=None, min_length=2, max_length=12, pattern=r"^[A-Z0-9]+$")
    quote_prefix: str | None = Field(default=None, min_length=2, max_length=12, pattern=r"^[A-Z0-9]+$")
    payment_prefix: str | None = Field(default=None, min_length=2, max_length=12, pattern=r"^[A-Z0-9]+$")
    logo_url: str | None = Field(default=None, max_length=500)
    stamp_url: str | None = Field(default=None, max_length=500)
    signature_url: str | None = Field(default=None, max_length=500)


class DocumentTemplateCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_type: Literal["quote", "invoice", "receipt"]
    name: str = Field(..., min_length=1, max_length=100)
    is_default: bool = False
    header_notes: str = Field(default="", max_length=2000)
    default_terms: str = Field(default="", max_length=4000)
    footer_notes: str = Field(default="", max_length=2000)
    config_json: dict[str, Any] = Field(default_factory=dict)


class DocumentTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_type: str
    name: str
    is_default: bool
    header_notes: str
    default_terms: str
    footer_notes: str
    config_json: dict[str, Any]
    active: bool
    created_at: datetime


class FileUploadJsonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    original_filename: str = Field(..., min_length=1, max_length=255)
    mime_type: str = Field(..., min_length=3, max_length=120)
    content_base64: str = Field(..., min_length=1)
    access_classification: Literal[
        "public_branding", "authenticated", "confidential_client", "immutable_financial_pdf"
    ] = "authenticated"
    entity_type: str | None = Field(default=None, max_length=50)
    entity_id: uuid.UUID | None = None


class FileMetadataOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    original_filename: str
    storage_key: str
    mime_type: str
    file_size_bytes: int
    checksum_sha256: str | None
    access_classification: str
    entity_type: str | None
    entity_id: uuid.UUID | None
    version: int
    uploaded_by: uuid.UUID | None
    created_at: datetime


def _sanitize_and_validate_upload(
    filename: str,
    mime_type: str,
    raw_bytes: bytes,
) -> tuple[str, str, str]:
    if not filename or ".." in filename or "/" in filename or "\\" in filename or "\x00" in filename:
        raise BadRequestError("Unsafe filename rejected", code="UNSAFE_FILENAME")

    clean_name = SAFE_FILENAME_RE.sub("_", Path(filename).name).strip("._")
    if not clean_name:
        raise BadRequestError("Invalid filename", code="INVALID_FILENAME")

    ext = Path(clean_name).suffix.lower()
    clean_mime = mime_type.split(";")[0].strip().lower()
    if clean_mime not in ALLOWED_MIME_EXTENSIONS:
        raise BadRequestError(
            f"Unsupported MIME type '{clean_mime}'",
            code="UNSUPPORTED_FILE_TYPE",
            details={"allowed": sorted(ALLOWED_MIME_EXTENSIONS.keys())},
        )
    if ext not in ALLOWED_MIME_EXTENSIONS[clean_mime]:
        raise BadRequestError(
            f"File extension '{ext}' does not match MIME type '{clean_mime}'",
            code="EXTENSION_MIME_MISMATCH",
        )
    if len(raw_bytes) == 0:
        raise BadRequestError("Uploaded file cannot be empty", code="EMPTY_FILE")
    if len(raw_bytes) > settings.max_upload_size_bytes:
        raise BadRequestError(
            f"Uploaded file exceeds maximum size of {settings.max_upload_size_bytes} bytes",
            code="FILE_TOO_LARGE",
        )

    # Magic-byte sanity checks for binary formats
    if clean_mime == "application/pdf" and not raw_bytes.startswith(b"%PDF-"):
        raise BadRequestError("File content is not a valid PDF document", code="INVALID_FILE_SIGNATURE")
    if clean_mime == "image/png" and not raw_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        raise BadRequestError("File content is not a valid PNG image", code="INVALID_FILE_SIGNATURE")
    if clean_mime == "image/jpeg" and not raw_bytes.startswith(b"\xff\xd8\xff"):
        raise BadRequestError("File content is not a valid JPEG image", code="INVALID_FILE_SIGNATURE")
    if clean_mime == "image/webp" and (
        len(raw_bytes) < 12 or not raw_bytes.startswith(b"RIFF") or raw_bytes[8:12] != b"WEBP"
    ):
        raise BadRequestError("File content is not a valid WebP image", code="INVALID_FILE_SIGNATURE")

    storage_name = f"{uuid.uuid4().hex}{ext}"
    return clean_name, clean_mime, storage_name


def _parse_multipart_upload(content_type: str, body: bytes) -> dict[str, Any]:
    raw_msg = b"Content-Type: " + content_type.encode("utf-8") + b"\r\n\r\n" + body
    msg = BytesParser(policy=email_default_policy).parsebytes(raw_msg)
    if not msg.is_multipart():
        raise BadRequestError("Invalid multipart/form-data payload")

    fields: dict[str, Any] = {}
    for part in msg.iter_parts():
        disp = part.get("Content-Disposition", "")
        name_match = re.search(r'name="([^"]+)"', disp)
        if not name_match:
            continue
        field_name = name_match.group(1)
        filename_match = re.search(r'filename="([^"]+)"', disp)
        payload_bytes = part.get_payload(decode=True) or b""
        if filename_match:
            fields["file_bytes"] = payload_bytes
            fields["original_filename"] = filename_match.group(1)
            fields["mime_type"] = part.get_content_type()
        else:
            fields[field_name] = payload_bytes.decode("utf-8", errors="replace").strip()

    if "file_bytes" not in fields:
        raise BadRequestError("Multipart upload requires a 'file' field")
    return fields


@router.get("/settings", response_model=ApiResponse[CompanySettingsOut])
def get_company_settings(
    _user: AuthenticatedUser = Depends(require_permission("company:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[CompanySettingsOut]:
    row = ensure_company_settings(db)
    db.commit()
    return ApiResponse(
        data=CompanySettingsOut.model_validate(row),
        message="Company settings retrieved successfully",
    )


@router.put("/settings", response_model=ApiResponse[CompanySettingsOut])
@router.patch("/settings", response_model=ApiResponse[CompanySettingsOut])
def update_company_settings(
    payload: CompanySettingsUpdateRequest,
    admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[CompanySettingsOut]:
    row = ensure_company_settings(db)
    before = {
        "name": row.name,
        "currency": row.currency,
        "number_prefix": row.number_prefix,
        "invoice_prefix": row.invoice_prefix,
        "quote_prefix": row.quote_prefix,
    }

    update_data = payload.model_dump(exclude_unset=True)
    for field_name, val in update_data.items():
        if val is not None:
            setattr(row, field_name, val.strip() if isinstance(val, str) else val)

    row.updated_by = admin.id
    after = {
        "name": row.name,
        "currency": row.currency,
        "number_prefix": row.number_prefix,
        "invoice_prefix": row.invoice_prefix,
        "quote_prefix": row.quote_prefix,
    }
    record_audit_log(
        db,
        actor_id=admin.id,
        action="company_settings.updated",
        resource_type="company_settings",
        resource_id="1",
        before_state=before,
        after_state=after,
    )
    db.commit()
    db.refresh(row)
    return ApiResponse(
        data=CompanySettingsOut.model_validate(row),
        message="Company settings updated successfully",
    )


@router.get("/templates", response_model=ApiResponse[list[DocumentTemplateOut]])
def list_document_templates(
    document_type: str | None = None,
    _user: AuthenticatedUser = Depends(require_permission("company:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[list[DocumentTemplateOut]]:
    stmt = select(DocumentTemplate).where(DocumentTemplate.active.is_(True))
    if document_type:
        stmt = stmt.where(DocumentTemplate.document_type == document_type)
    rows = list(db.execute(stmt.order_by(DocumentTemplate.created_at.desc())).scalars().all())
    return ApiResponse(
        data=[DocumentTemplateOut.model_validate(r) for r in rows],
        message="Document templates retrieved successfully",
    )


@router.post("/templates", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[DocumentTemplateOut])
def create_document_template(
    payload: DocumentTemplateCreateRequest,
    admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[DocumentTemplateOut]:
    tpl = DocumentTemplate(
        document_type=payload.document_type,
        name=payload.name.strip(),
        is_default=payload.is_default,
        header_notes=payload.header_notes,
        default_terms=payload.default_terms,
        footer_notes=payload.footer_notes,
        config_json=payload.config_json,
        updated_by=admin.id,
    )
    db.add(tpl)
    db.flush()
    record_audit_log(
        db,
        actor_id=admin.id,
        action="document_template.created",
        resource_type="document_template",
        resource_id=tpl.id,
    )
    db.commit()
    db.refresh(tpl)
    return ApiResponse(
        data=DocumentTemplateOut.model_validate(tpl),
        message="Document template created successfully",
    )


@router.post("/files", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[FileMetadataOut])
async def upload_file(
    request: Request,
    user: AuthenticatedUser = Depends(require_permission("clients:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[FileMetadataOut]:
    """
    Accepts either JSON (`FileUploadJsonRequest` with `content_base64`) or `multipart/form-data`.
    Validates file extension, MIME type, magic bytes, and size, stores binary outside PostgreSQL,
    and records metadata in `public.file_metadata`.
    """
    content_type = request.headers.get("content-type", "")
    raw_body = await request.body()

    if "multipart/form-data" in content_type.lower():
        parsed = _parse_multipart_upload(content_type, raw_body)
        original_filename = str(parsed["original_filename"])
        mime_type = str(parsed["mime_type"])
        file_bytes = bytes(parsed["file_bytes"])
        access_classification = str(parsed.get("access_classification", "authenticated"))
        entity_type = parsed.get("entity_type")
        entity_id = uuid.UUID(parsed["entity_id"]) if parsed.get("entity_id") else None
    else:
        json_data = await request.json()
        payload = FileUploadJsonRequest.model_validate(json_data)
        original_filename = payload.original_filename
        mime_type = payload.mime_type
        try:
            file_bytes = base64.b64decode(payload.content_base64, validate=True)
        except Exception as exc:
            raise BadRequestError("Invalid base64 file content") from exc
        access_classification = payload.access_classification
        entity_type = payload.entity_type
        entity_id = payload.entity_id

    if access_classification == "public_branding" and user.role != "admin" and "admin" not in user.roles:
        raise AuthorizationError("Only administrators can upload public branding assets")

    clean_name, clean_mime, storage_name = _sanitize_and_validate_upload(
        original_filename, mime_type, file_bytes
    )

    checksum = hashlib.sha256(file_bytes).hexdigest()
    target_path = (settings.upload_storage_dir / storage_name).resolve()
    if settings.upload_storage_dir.resolve() not in target_path.parents:
        raise BadRequestError("Path traversal blocked", code="PATH_TRAVERSAL_DETECTED")

    target_path.write_bytes(file_bytes)

    meta = FileMetadata(
        original_filename=clean_name,
        storage_key=storage_name,
        mime_type=clean_mime,
        file_size_bytes=len(file_bytes),
        checksum_sha256=checksum,
        access_classification=access_classification,
        entity_type=entity_type,
        entity_id=entity_id,
        uploaded_by=user.id,
    )
    db.add(meta)
    db.flush()

    record_audit_log(
        db,
        actor_id=user.id,
        action="file.uploaded",
        resource_type="file_metadata",
        resource_id=meta.id,
        after_state={
            "original_filename": clean_name,
            "mime_type": clean_mime,
            "file_size_bytes": len(file_bytes),
            "access_classification": access_classification,
        },
    )
    db.commit()
    db.refresh(meta)
    return ApiResponse(
        data=FileMetadataOut.model_validate(meta),
        message="File uploaded and verified successfully",
    )


@router.get("/files/{file_id}/download")
def download_file(
    file_id: uuid.UUID,
    user: AuthenticatedUser = Depends(require_permission("company:read")),
    db: Session = Depends(get_db),
) -> Response:
    meta = db.get(FileMetadata, file_id)
    if not meta:
        raise NotFoundError("FileMetadata", details={"file_id": str(file_id)})

    if meta.access_classification == "confidential_client" and not user.has_permission("clients:read"):
        raise AuthorizationError("Not authorized to download confidential client files")

    target_path = (settings.upload_storage_dir / Path(meta.storage_key).name).resolve()
    if not target_path.is_file() or settings.upload_storage_dir.resolve() not in target_path.parents:
        raise NotFoundError("Stored file binary", details={"file_id": str(file_id)})

    record_audit_log(
        db,
        actor_id=user.id,
        action="file.downloaded",
        resource_type="file_metadata",
        resource_id=meta.id,
    )
    db.commit()

    return Response(
        content=target_path.read_bytes(),
        media_type=meta.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{meta.original_filename}"',
            "X-Checksum-SHA256": meta.checksum_sha256 or "",
        },
    )
