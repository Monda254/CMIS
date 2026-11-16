"""
Server-Side A4 PDF Generation for Quotations, Invoices, and Receipts using ReportLab + QR Code (Sections 10.4, 10.5, 10.7).
Preserves historical document snapshots and marks duplicate reprints (>1) with a visible banner.
"""

from __future__ import annotations

import io
from decimal import Decimal
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def render_commercial_document_pdf(
    *,
    doc_title: str,
    doc_number: str,
    status: str,
    issue_date: str,
    secondary_date_label: str | None,
    secondary_date_value: str | None,
    currency: str,
    company_snapshot: dict[str, Any] | None,
    client_snapshot: dict[str, Any] | None,
    items: list[dict[str, Any]],
    subtotal: Decimal,
    discount_total: Decimal,
    tax_total: Decimal,
    total: Decimal,
    amount_paid_or_allocated: Decimal | None = None,
    balance_due: Decimal | None = None,
    notes: str = "",
    terms: str = "",
    verification_url: str | None = None,
    print_count: int = 1,
) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4

    company = company_snapshot or {}
    client = client_snapshot or {}
    company_name = str(company.get("name") or "Ledgerly Commercial Solutions Ltd")
    company_address = str(company.get("address") or "Nairobi, Kenya")
    company_phone = str(company.get("phone") or "")
    company_email = str(company.get("email") or "")

    # Header band
    c.setFillColor(colors.HexColor("#111827"))
    c.rect(0, height - 95, width, 95, fill=1, stroke=0)

    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(40, height - 45, company_name[:50])
    c.setFont("Helvetica", 9)
    c.drawString(40, height - 62, f"{company_address}  |  {company_phone}  |  {company_email}".strip(" |"))

    c.setFont("Helvetica-Bold", 16)
    c.drawRightString(width - 40, height - 45, doc_title.upper())
    c.setFont("Helvetica", 10)
    c.drawRightString(width - 40, height - 62, f"No: {doc_number}   Status: {status.upper()}")

    y = height - 125

    # Duplicate copy banner when print_count > 1
    if print_count > 1:
        c.setFillColor(colors.HexColor("#FEF3C7"))
        c.rect(40, y - 18, width - 80, 22, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#92400E"))
        c.setFont("Helvetica-Bold", 9)
        c.drawString(50, y - 10, f"DUPLICATE COPY #{print_count} — HISTORICAL SNAPSHOT PRESERVED")
        y -= 35

    # Client & Document Metadata
    c.setFillColor(colors.HexColor("#111827"))
    c.setFont("Helvetica-Bold", 10)
    c.drawString(40, y, "BILL TO / CLIENT:")
    c.setFont("Helvetica", 10)
    c.drawString(40, y - 15, str(client.get("name") or "Valued Client")[:60])
    if client.get("phone"):
        c.drawString(40, y - 29, f"Tel: {client.get('phone')}")
    if client.get("address"):
        c.drawString(40, y - 43, str(client.get("address"))[:60])

    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(width - 40, y, f"Issue Date: {issue_date}")
    if secondary_date_label and secondary_date_value:
        c.setFont("Helvetica", 10)
        c.drawRightString(width - 40, y - 15, f"{secondary_date_label}: {secondary_date_value}")

    y -= 70

    # Line items header
    c.setFillColor(colors.HexColor("#F3F4F6"))
    c.rect(40, y - 16, width - 80, 20, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#111827"))
    c.setFont("Helvetica-Bold", 9)
    c.drawString(48, y - 10, "Description")
    c.drawRightString(width - 210, y - 10, "Qty")
    c.drawRightString(width - 130, y - 10, f"Unit ({currency})")
    c.drawRightString(width - 48, y - 10, f"Line Total ({currency})")

    y -= 32
    c.setFont("Helvetica", 9)
    for item in items[:25]:
        desc = str(item.get("description") or "")[:55]
        qty = f"{Decimal(str(item.get('quantity', '1'))):.2f}"
        uprice = f"{Decimal(str(item.get('unit_price', '0.00'))):,.2f}"
        ltotal = f"{Decimal(str(item.get('line_total', '0.00'))):,.2f}"
        c.drawString(48, y, desc)
        c.drawRightString(width - 210, y, qty)
        c.drawRightString(width - 130, y, uprice)
        c.drawRightString(width - 48, y, ltotal)
        y -= 16
        if y < 180:
            c.showPage()
            y = height - 60

    y -= 12
    c.setStrokeColor(colors.HexColor("#D1D5DB"))
    c.line(40, y, width - 40, y)
    y -= 20

    # Summary Totals
    c.setFont("Helvetica", 10)
    c.drawRightString(width - 140, y, "Subtotal:")
    c.drawRightString(width - 48, y, f"{currency} {subtotal:,.2f}")
    y -= 16
    if discount_total > 0:
        c.drawRightString(width - 140, y, "Discount:")
        c.drawRightString(width - 48, y, f"- {currency} {discount_total:,.2f}")
        y -= 16
    if tax_total > 0:
        c.drawRightString(width - 140, y, "Tax:")
        c.drawRightString(width - 48, y, f"{currency} {tax_total:,.2f}")
        y -= 16

    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(width - 140, y, "TOTAL:")
    c.drawRightString(width - 48, y, f"{currency} {total:,.2f}")
    y -= 18

    if amount_paid_or_allocated is not None:
        c.setFont("Helvetica", 10)
        c.drawRightString(width - 140, y, "Paid / Allocated:")
        c.drawRightString(width - 48, y, f"{currency} {amount_paid_or_allocated:,.2f}")
        y -= 16

    if balance_due is not None:
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(width - 140, y, "Balance Due:")
        c.drawRightString(width - 48, y, f"{currency} {balance_due:,.2f}")
        y -= 20

    if verification_url:
        c.setFont("Helvetica", 8)
        c.setFillColor(colors.HexColor("#4B5563"))
        c.drawString(40, 75, f"Public Verification URL: {verification_url}")

    if notes or terms:
        c.setFont("Helvetica", 8)
        c.setFillColor(colors.HexColor("#4B5563"))
        c.drawString(40, 58, f"Notes/Terms: {(notes or terms)[:100]}")

    c.showPage()
    c.save()
    return buf.getvalue()
