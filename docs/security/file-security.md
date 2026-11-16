# IBMS File Upload, Storage & Download Security (`MP-17`)

## 1. Upload Validation Controls (`SEC-03`)

Both the FastAPI file storage service (`POST /api/v1/files/upload` in `fastapi_service/modules/company.py`) and the Next.js branding upload endpoint (`POST /api/settings/branding` in `src/app/api/settings/branding/route.ts`) enforce 5 mandatory validation layers:

1. **Path Traversal Stripping**: File names are stripped of directory components via `Path(payload.file_name).name` and checked against `..`, `/`, and `\`.
2. **Extension Blocklist & Allowlist**:
   - Explicitly blocked executable/script extensions: `.exe`, `.sh`, `.bat`, `.cmd`, `.php`, `.py`, `.js`, `.jsp`, `.asp`, `.aspx`, `.dll`, `.so`, `.bin`, `.cgi`, `.pl`, `.rb`, `.jar`, `.war`, `.msi`, `.vbs`, `.ps1`, `.html`, `.htm`, `.svg`.
   - Allowed extensions: `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.csv`, `.xlsx`, `.txt`.
3. **MIME Type Allowlist**: Restricted to `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `text/csv`, `text/plain`, and `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
4. **Binary Magic-Byte Signature Verification (`SEC-03`)**:
   - `application/pdf`: Must begin with `%PDF-` (`25 50 44 46 2D`).
   - `image/png`: Must begin with `\x89PNG\r\n\x1a\n` (`89 50 4E 47 0D 0A 1A 0A`).
   - `image/jpeg`: Must begin with `\xff\xd8\xff` (`FF D8 FF`).
   - `image/webp`: Must begin with `RIFF` (`bytes[0:4] == b"RIFF"`) and contain `WEBP` at `bytes[8:12] == b"WEBP"`.
   - Payloads whose binary header does not match their declared MIME type are rejected immediately with `400 INVALID_FILE_SIGNATURE`.
5. **Strict Size Quotas & Checksums**:
   - Branding assets (`logo`, `stamp`, `signature`): Max `2 MB` (`2,097,152` bytes).
   - General attachments/statements: Max `10 MB` (`10,485,760` bytes).
   - Every stored file computes and stores a `SHA-256` content digest (`checksum_sha256`).

## 2. Secure Storage & Download Hardening

- **Randomized Storage Keys**: Uploaded files are never saved under user-supplied filenames; they are assigned randomized UUID keys (`<bucket>/<uuid4><ext>`).
- **Authenticated Downloads & Anti-Sniffing Headers**:
  - `GET /api/v1/files/{file_id}/download` requires authentication (`get_current_user`) and serves files with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
  - `GET /api/branding/[...path]` verifies canonical path containment inside `public/uploads/branding` (`!resolvedPath.startsWith(baseDir + path.sep)`) and sets `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox`.
- **Spreadsheet Formula Injection Protection**: CSV and Excel exports (`src/lib/utils/csv-sanitize.ts`, `src/app/api/reports/export/route.ts`, `fastapi_service/modules/reports.py`) prefix any cell starting with `=`, `+`, `-`, `@`, `\t`, or `\r` with a single quote (`'`) to prevent formula execution in Excel/LibreOffice.
