# EvidenceGuard
> **Digital Evidence Protection & Verification System** — A cryptographic custody ledger and tamper-detection platform for forensic digital evidence.

> **Notice:** *Blockchain-inspired hash-chain prototype; not a real blockchain.* EvidenceGuard demonstrates how cryptographic hashing, sequential block-linkage, append-only logging, and automated integrity validation operate to detect unauthorized modifications to digital evidence.

---

## 1. Problem Statement
Digital evidence (surveillance footage, forensic disk images, audio recordings, documents) is fundamentally intangible and fragile. Files stored on conventional servers can be altered, swapped, or deleted by unauthorized actors or privileged insiders without leaving physical traces. In courtroom proceedings, any doubt regarding chain of custody or bit-level authenticity can lead to evidence dismissal and failed prosecutions. Traditional relational databases alone cannot mathematically guarantee that an evidence record has remained untouched since acquisition.

## 2. Project Objectives
- **Integrity Assurance:** Ensure bit-exact cryptographic verification of stored evidence against its intake fingerprint.
- **Instant Tamper Detection:** Instantly pinpoint and flag any modification (even a single bit in a gigabyte file) with a visual alert and security audit record.
- **Immutable Chain of Custody:** Provide an append-only, chronologically linked record of all forensic actions from intake to courtroom presentation.
- **Granular Access Control:** Enforce strict Role-Based Access Control (Admin, Investigator, Viewer) across both frontend UI and backend REST API endpoints.
- **Educational Demonstration:** Provide an intuitive, transparent prototype demonstrating cryptographic chaining concepts (`previousHash`, Merkle-like sequential hashing, genesis blocks) in an approachable web architecture.
- **Public Trust & Verification:** Permit independent third-party verification via QR codes and public lookup cards without exposing sensitive internal file locations or custodian data.

---

## 3. Features
- **Deterministic SHA-256 Hashing:** Streaming server-side cryptographic hash calculation combined with pre-upload client-side Web Crypto hashing.
- **Duplicate Prevention:** Atomic SHA-256 uniqueness constraint prevents re-uploading identical evidence, stopping ledger spam.
- **Blockchain-Inspired Ledger:** Sequential blocks cryptographically linked via `previousHash` and validated against parent block signatures.
- **Dual-Chain Verification:** Independent validation engines for both the Evidence Block Ledger and the Audit Log Event Chain.
- **Append-Only Audit Trail:** Cryptographically hashed, sequentially numbered audit trail recording all 13 canonical system events (`REGISTER`, `LOGIN`, `LOGOUT`, `UPLOAD`, `HASH_GENERATED`, `VERIFY`, `TAMPER_DETECTED`, `DELETE`, `BLOCK_CREATED`, `BLOCKCHAIN_VALIDATED`, `USER_CREATED`, `ROLE_CHANGED`, `QR_GENERATED`).
- **One-Click Evidence Verification:** Upload any file at any time to compare its current SHA-256 against registered ledger records.
- **QR Code & Public Verification Card:** Generates mobile-scannable QR codes pointing to sanitized, whitelisted public verification endpoints.
- **Executive Real-Time Dashboard:** Real-time KPI statistics, 7-day verification activity charts, tamper rates, recent evidence, and on-demand ledger health validation.
- **Cryptographic Chain of Custody & Handshake:** Complete physical and digital custody timeline with SHA-256 entry hashing and `prevHash` linkage. Features two-phase officer transfer handshakes (Initiate / Accept / Reject), automatic `ACCESSED` logging on download and verification, terminal external `RELEASED` states with Admin return override, dedicated Custody Hub (`custody.html`), and unbroken cryptographic chain validation.
- **Safe Soft-Deletion:** Admin-only soft deletion preserving ledger blocks and cryptographic continuity while removing physical storage files.
- **Hardened Security Architecture:** OWASP-compliant security headers (Helmet CSP, HSTS, no-sniff), rate limiting, NoSQL injection guards, and `HttpOnly` `SameSite=Lax` session cookies.

---

## 4. Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                                  CLIENT LAYER                                     |
|  Web Browser (Desktop / Mobile)                 Third-Party / Public Auditor     |
|  - HTML5, Vanilla CSS3 (Dark Theme)             - Mobile Camera / QR Scanner      |
|  - Vanilla JavaScript & Web Crypto API          - Public Verification Card        |
+-----------------------------------------+-----------------------------------------+
                                          | HTTP / TLS (Port 3000)
                                          v
+-----------------------------------------------------------------------------------+
|                             API & MIDDLEWARE LAYER                                |
|  - Helmet HTTP Security Headers (CSP, Referrer-Policy, nosniff, frameguard)       |
|  - Express Rate Limiters (Auth: 10/15min, Public: 60/15min, Verify: 60/15min)     |
|  - JWT Authentication Middleware (HttpOnly Cookie verification)                   |
|  - RBAC Authorization Gates ('view', 'upload', 'verify', 'delete', 'manageUsers') |
|  - Multer File Upload & Type Whitelisting (50MB cap, magic byte/MIME checking)    |
|  - Centralized Error Handler (Clean JSON errors, zero stack trace leakage)         |
+-----------------------------------------+-----------------------------------------+
                                          |
        +---------------------------------+---------------------------------+
        |                                                                   |
        v                                                                   v
+-----------------------+   +-----------------------+   +---------------------------+
|   EVIDENCE SERVICE    |   |   BLOCKCHAIN SERVICE  |   |    AUDIT CHAIN SERVICE    |
| - SHA-256 Stream Hash |   | - Genesis Block Init  |   | - Canonical JSON Format   |
| - Duplicate Check     |   | - Canonical Form Hash |   | - Sequential Counter seq  |
| - Local Disk Storage  |   | - prevHash Linkage    |   | - prevHash Event Chaining |
| - Metadata Extraction |   | - Full Chain Audit    |   | - Mongoose Append Pre-Hook|
+-----------+-----------+   +-----------+-----------+   +-------------+-------------+
            |                           |                             |
            +---------------------------+-----------------------------+
                                        | Mongoose ODM / Transactions
                                        v
+-----------------------------------------------------------------------------------+
|                                DATABASE LAYER (MongoDB)                           |
|  Collections: Users | Evidence | Blocks | AuditLogs | Verifications | SystemStatus|
+-----------------------------------------------------------------------------------+
```

---

## 5. Technology Stack
- **Runtime Environment:** Node.js (v18.x – v22.x)
- **Web Framework:** Express.js (v5.x)
- **Database:** MongoDB (v6.x – v7.x) via Mongoose ODM (v8.x/v9.x)
- **In-Memory Test Database:** `mongodb-memory-server`
- **Cryptography & Security:**
  - `crypto` (Native Node.js SHA-256 hashing)
  - `bcrypt` (Password hashing, work factor 10)
  - `jsonwebtoken` (JWT stateless authentication)
  - `helmet` (HTTP security headers)
  - `express-rate-limit` (DDoS and brute-force mitigation)
  - `cookie-parser` (Secure cookie extraction)
- **File Handling & QR Codes:**
  - `multer` (Streaming multipart form handling)
  - `qrcode` (SVG and PNG QR code generation)
- **Frontend:** Pure Vanilla HTML5, CSS3 Custom Properties (Design System), Vanilla JavaScript (Modular ES6), Web Crypto API. Zero external CSS/JS framework dependencies.

---

## 6. Folder Structure

```
EvidenceGuard/
├── config/
│   └── db.js                       # MongoDB connection & transaction support detection
├── controllers/
│   ├── authController.js           # Register, login, logout, /me
│   ├── evidenceController.js       # Upload, query, search, details, soft-delete, QR
│   ├── custodyController.js        # Custody timeline, transfers, handshake acceptance, officer listing
│   ├── verificationController.js   # Hash comparison, verify attempt logging
│   ├── blockchainController.js     # Block exploration & chain validation trigger
│   ├── auditController.js          # Audit query, filter, & audit chain validation
│   ├── userController.js           # User listing, creation, role change, deactivation
│   └── dashboardController.js      # Aggregated metrics, trend charts, system status
├── middleware/
│   ├── auth.js                     # JWT extraction & RBAC action authorization
│   ├── uploadMiddleware.js         # Multer configuration, 50MB limit, MIME filters
│   └── errorHandler.js             # Centralized application error codes & JSON format
├── models/
│   ├── User.js                     # User schema (email, passwordHash, role, isActive)
│   ├── Evidence.js                 # Evidence metadata, SHA-256 hash, soft-delete flags
│   ├── CustodyEvent.js             # Custody log with sequential hash chaining & transfer tracking
│   ├── Block.js                    # Ledger blocks (blockNumber, evidenceHash, previousHash)
│   ├── AuditLog.js                 # Append-only audit records with sequential entryHash
│   ├── Verification.js             # Historical record of all file verification attempts
│   ├── Counter.js                  # Atomic sequence generator for IDs (EV-xxxx, seq)
│   └── SystemStatus.js             # Singleton for caching chain validation outcomes
├── public/
│   ├── index.html                  # Public Landing Page with interactive workflow
│   ├── about.html                  # Architecture, security model, and limitations
│   ├── login.html                  # Authentication & registration interface
│   ├── dashboard.html              # Protection dashboard, analytics, and health status
│   ├── evidence.html               # Evidence upload & catalog management
│   ├── evidence-details.html       # Deep evidence inspector, custody timeline, action modals
│   ├── custody.html                # Officer Chain of Custody Hub (Held, Incoming, Outgoing)
│   ├── verify.html                 # Verification portal & public Case ID lookup
│   ├── blockchain.html             # Blockchain ledger viewer & validator trigger
│   ├── audit.html                  # Audit trail explorer & audit chain validator
│   ├── users.html                  # User administration (Admin only)
│   ├── keys.html                   # Officer digital key generation & zero-knowledge storage
│   ├── style.css                   # Global Design System (Dark Navy, Cyan/Blue glow)
│   ├── script.js                   # Shared layout logic, navbar, toasts, live clocks
│   └── page-logic.js               # Page-specific business logic & API bindings
├── routes/
│   ├── authRoutes.js               # /api/auth
│   ├── evidenceRoutes.js           # /api/evidence & /api/evidence/:id/custody
│   ├── custodyRoutes.js            # /api/custody (/mine, /officers, /:id/accept, /reject, /cancel)
│   ├── blockchainRoutes.js         # /api/blockchain
│   ├── auditRoutes.js              # /api/audit
│   ├── userRoutes.js               # /api/users
│   ├── dashboardRoutes.js          # /api/dashboard
│   └── publicRoutes.js             # /api/public
├── services/
│   ├── hashService.js              # Streaming file SHA-256 calculation
│   ├── custodyService.js           # Custody events, validation, optimistic locking, auto-logging
│   ├── chainService.js             # Genesis block initialization & block creation
│   ├── chainHash.js                # Deterministic block hashing formula
│   ├── chainValidator.js           # 6-point ledger integrity validation engine
│   ├── auditService.js             # Append-only audit logging helper
│   ├── auditHash.js                # Deterministic audit entry hashing & chain validator
│   ├── verificationService.js      # Evidence resolution & verification orchestration
│   ├── storageService.js           # Local disk file storage & removal abstraction
│   ├── idService.js                # Atomic sequential ID generation (EV-0001, EG-YYYY-0001)
│   └── tokenService.js             # JWT minting and validation
├── scripts/
│   ├── run-all-tests.js            # Master test runner (npm test) - 18 test suites
│   ├── test-custody.js             # Custody model, API, RBAC, state machine & tamper tests
│   ├── test-custody-ui.js          # Custody UI components & end-to-end handshake tests
│   ├── migrate-custody.js          # Backfill legacy evidence with genesis custody records
│   ├── test-e2e.js                 # 14-step live master-spec workflow test
│   ├── create-admin.js             # Bootstrap administrator creation utility
│   ├── seed.js                     # Demo data seeder with 4 realistic cases
│   ├── tamper-demo.js              # Interactive tampering & restoration demonstration
│   ├── scan-secrets.js             # Automated secrets & credentials leak scanner
│   ├── make-demo-files.js          # Demo files generator (genuine and altered)
│   └── verify-fresh-install.js     # Clean installation verification script
├── docs/
│   ├── TEST-CHECKLIST.md           # Manual browser walkthrough & negative test matrix
│   ├── DEMO-SCRIPT.md              # 5-minute presentation script with 10 viva Q&As
│   └── screenshots/                # Application screenshots directory
├── server.js                       # Express application bootstrap & route mounting
├── package.json                    # Project metadata, scripts, and dependencies
└── .env.example                    # Environment variable documentation template
```

---

## 7. Database Schema & Data Models

### 1. `users`
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `_id` | ObjectId | Auto | MongoDB primary key |
| `name` | String | Required, Trim | Full name of user |
| `email` | String | Required, Unique, Lowercase | Login email address |
| `passwordHash` | String | Required | bcrypt hash (work factor 10) |
| `role` | String | Enum: `ADMIN`, `INVESTIGATOR`, `VIEWER` | RBAC access level (default: `VIEWER`) |
| `isActive` | Boolean | Default: `true` | Soft-deactivation flag |
| `createdAt` | Date | Default: `Date.now` | Account creation timestamp |
| `updatedAt` | Date | Default: `Date.now` | Last profile update timestamp |

**Indexes:** `email` (unique).

### 2. `evidence`
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `evidenceId` | String | Required, Unique, Uppercase | Sequential ID format `EV-0001` |
| `caseId` | String | Required, Index | Case identifier format `EG-YYYY-0001` |
| `name` | String | Required, Trim | Name/title of evidence item |
| `type` | String | Enum: `Image`, `Video`, `Audio`, `Document`, `PDF`, `Other` | Evidence category |
| `fileName` | String | Required | Original filename at upload |
| `fileSize` | Number | Required | Size in bytes |
| `mimeType` | String | Required | Validated MIME type |
| `hash` | String | Required, Length 64 | Server-calculated SHA-256 digest |
| `storageKey` | String | Required | Internal disk filename (never leaked to public) |
| `status` | String | Enum: `Pending`, `Verified`, `Tampered` | Latest verification outcome (default: `Pending`) |
| `uploadedBy` | ObjectId | Ref: `User` | User who registered the evidence |
| `isDeleted` | Boolean | Default: `false` | Soft-deletion flag |
| `deletedAt` | Date | Optional | Timestamp of soft-deletion |
| `deletedBy` | ObjectId | Ref: `User` | Admin user who performed deletion |
| `isDemo` | Boolean | Default: `false` | Marks sample seed data |

**Indexes:** `evidenceId` (unique), `caseId`, `hash` (unique partial index where `isDeleted: false`), compound `(type, createdAt: -1)`, compound `(status, createdAt: -1)`.

### 3. `blocks`
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `blockNumber` | Number | Required, Unique, Min: 0 | Sequential block index (0 = Genesis) |
| `evidenceId` | String | Required (or "GENESIS") | Associated evidence ID |
| `caseId` | String | Required (or "GENESIS") | Associated case ID |
| `evidenceHash` | String | Required, Length 64 | SHA-256 of the evidence asset |
| `previousHash` | String | Required, Length 64 | `currentHash` of block `N-1` |
| `currentHash` | String | Required, Unique, Length 64 | Cryptographic signature of this block |
| `timestamp` | Date | Required | Timestamp block was mined/created |

**Indexes:** `blockNumber` (unique), `previousHash` (unique), `currentHash` (unique), `evidenceId`.

### 4. `auditlogs`
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `eventId` | String | Required, Unique | Unique event UUID |
| `seq` | Number | Required, Unique, Min: 1 | Contiguous sequential integer |
| `timestamp` | Date | Required, Index | Event generation timestamp |
| `action` | String | Required, Enum (14 actions) | Canonical event type |
| `userId` | ObjectId | Optional, Ref: `User` | Acting user ID (null for system) |
| `userName` | String | Required | Display name of actor |
| `role` | String | Required | Role of actor at event time |
| `evidenceId` | String | Optional | Linked evidence ID |
| `caseId` | String | Optional | Linked case ID |
| `description` | String | Required | Human-readable log narrative |
| `ipAddress` | String | Optional | Client IP (Admin only projection) |
| `prevHash` | String | Required, Length 64 | `entryHash` of entry `seq - 1` |
| `entryHash` | String | Required, Unique, Length 64 | Cryptographic signature of this audit row |

**Indexes:** `eventId` (unique), `seq` (unique), `timestamp` (-1), `action`, `evidenceId`, `caseId`.

### 5. `verifications`
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `verificationId` | String | Required, Unique | Identifier format `VR-0001` |
| `evidenceId` | String | Required, Index | Evidence evaluated |
| `caseId` | String | Required | Case evaluated |
| `submittedHash` | String | Required, Length 64 | SHA-256 of candidate file submitted |
| `registeredHash` | String | Required, Length 64 | Expected hash from Evidence record |
| `result` | String | Enum: `VERIFIED`, `TAMPERED` | Verification outcome |
| `chainConsistent`| Boolean | Required | True if associated block is intact |
| `verifiedBy` | ObjectId | Ref: `User` | User who triggered verification |
| `verifiedAt` | Date | Default: `Date.now` | Verification timestamp |

**Indexes:** `verificationId` (unique), compound `(evidenceId, verifiedAt: -1)`, `caseId`.

### 6. `custodyevents`
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `custodyId` | String | Required, Unique | Unique identifier format `CUST-YYYY-NNNN` |
| `evidenceId` | String | Required, Index | Associated evidence identifier |
| `seq` | Number | Required, Min: 1 | Sequential chain position for this evidence |
| `type` | String | Enum (10 types) | `COLLECTED`, `TRANSFER_INITIATED`, `TRANSFER_ACCEPTED`, `TRANSFER_REJECTED`, `TRANSFER_CANCELLED`, `ACCESSED`, `ANALYZED`, `STORED`, `RELEASED`, `RETURNED` |
| `actorUserId` | ObjectId | Required, Ref: `User` | Officer performing or logging the action |
| `toUserId` | ObjectId | Optional, Ref: `User` | Designee recipient for transfers |
| `reason` | String | Required, 5-500 chars | Justification or case note for custody event |
| `location` | String | Max 120 chars | Physical storage room, lab, or department |
| `conditionNotes`| String | Max 500 chars | Tamper seal integrity or packaging notes |
| `occurredAt` | Date | Default: `Date.now` | Event occurrence timestamp |
| `prevHash` | String | Required, Length 64 | `entryHash` of seq `N-1` (or 16 zeros for genesis) |
| `entryHash` | String | Required, Unique, Length 64 | Cryptographic signature of this custody event |

**Indexes:** `custodyId` (unique), compound `(evidenceId, seq: 1)` (unique), `actorUserId`, `toUserId`.

### 7. `counters`
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `_id` | String | Primary Key | Counter name (e.g. `evidenceId`, `auditSeq`) |
| `seq` | Number | Default: 0 | Atomic monotonically incrementing integer |

### 8. `systemstatuses`
| Field | Type | Attributes | Description |
| :--- | :--- | :--- | :--- |
| `key` | String | Required, Unique | Status key (e.g. `chainValidation`, `auditValidation`) |
| `value` | Mixed | Required | Cached validation object (valid, checked, timestamp) |
| `updatedAt` | Date | Default: `Date.now` | Timestamp of last background check |

---

## 8. API Documentation

### API Endpoints Summary

| Method | Path | Auth Required | Allowed Roles | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/api/health` | No | Public | Service health & MongoDB connection status |
| `POST`| `/api/auth/register` | No | Public | Register new user account (defaults to `VIEWER`) |
| `POST`| `/api/auth/login` | No | Public | Authenticate with email/password; receives JWT cookie |
| `POST`| `/api/auth/logout` | Yes | Any | Clear session cookie & log event |
| `GET` | `/api/auth/me` | Yes | Any | Return profile of currently authenticated user |
| `GET` | `/api/dashboard/stats` | Yes | Any | Return aggregated metrics tailored to caller role |
| `GET` | `/api/evidence` | Yes | Any | Query, filter, and paginate evidence catalog |
| `POST`| `/api/evidence` | Yes | ADMIN, INVESTIGATOR | Upload evidence file & register block in ledger |
| `GET` | `/api/evidence/lookup` | Yes | Any | Lookup non-sensitive metadata by Case ID or Evidence ID |
| `GET` | `/api/evidence/:id` | Yes | Any | Fetch full evidence detail (excludes storage keys) |
| `DELETE`| `/api/evidence/:id`| Yes | ADMIN | Soft-delete evidence, preserve block, remove file |
| `POST`| `/api/evidence/:id/verify` | Yes | Any | Upload candidate file to verify against registered hash |
| `GET` | `/api/evidence/:id/verifications` | Yes | Any | Retrieve chronological verification history |
| `GET` | `/api/evidence/:id/qr` | Yes | Any | Generate PNG/SVG QR code for public verification |
| `GET` | `/api/evidence/:id/download` | Yes | Any | Download evidence file asset with auto ACCESSED custody logging |
| `GET` | `/api/evidence/:id/custody` | Yes | ADMIN, INVESTIGATOR | Retrieve chronological custody timeline and current custodian |
| `POST`| `/api/evidence/:id/custody` | Yes | ADMIN, INVESTIGATOR | Append custody event (transfer, analysis, release, return) |
| `POST`| `/api/evidence/:id/custody/validate` | Yes | ADMIN, INVESTIGATOR | Execute full cryptographic custody hash-chain validation |
| `GET` | `/api/custody/mine` | Yes | ADMIN, INVESTIGATOR | Fetch caller's held evidence, incoming and outgoing transfers |
| `GET` | `/api/custody/officers` | Yes | ADMIN, INVESTIGATOR | Retrieve candidate active officers for custody transfer |
| `POST`| `/api/custody/:custodyId/accept` | Yes | ADMIN, INVESTIGATOR | Accept pending incoming custody transfer |
| `POST`| `/api/custody/:custodyId/reject` | Yes | ADMIN, INVESTIGATOR | Reject pending incoming custody transfer with reason |
| `POST`| `/api/custody/:custodyId/cancel` | Yes | ADMIN, INVESTIGATOR | Cancel initiated pending transfer before recipient acceptance |
| `GET` | `/api/public/verify/:caseId` | No | Public | Public unauthenticated verification card (strictly whitelisted) |
| `GET` | `/api/blockchain` | Yes | Any | List sequential ledger blocks (paginated) |
| `POST`| `/api/blockchain/validate` | Yes | ADMIN | Execute full cryptographic blockchain validation |
| `GET` | `/api/audit` | Yes | ADMIN, INVESTIGATOR | Query immutable audit log (IP visible to Admin only) |
| `GET` | `/api/audit/filters` | Yes | ADMIN, INVESTIGATOR | Retrieve distinct audit actors and available actions |
| `POST`| `/api/audit/validate` | Yes | ADMIN | Execute full cryptographic audit chain validation |
| `GET` | `/api/users` | Yes | ADMIN | List registered users with pagination & search |
| `POST`| `/api/users` | Yes | ADMIN | Create a new user with an explicit role |
| `PATCH`| `/api/users/:id/role`| Yes | ADMIN | Promote or demote user role (self-demotion protected) |
| `DELETE`| `/api/users/:id` | Yes | ADMIN | Soft-deactivate user account (self-deactivation protected) |

---

### Example Requests & Responses

#### 1. Register User (`POST /api/auth/register`)
**Request:**
```http
POST /api/auth/register HTTP/1.1
Content-Type: application/json

{
  "name": "Detective Miller",
  "email": "miller@evidenceguard.local",
  "password": "Password123!"
}
```
**Response (`201 Created`):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "user": {
    "id": "66f4b321a09148d281ef40a1",
    "name": "Detective Miller",
    "email": "miller@evidenceguard.local",
    "role": "VIEWER",
    "createdAt": "2026-10-02T12:00:00.000Z"
  }
}
```

#### 2. Login (`POST /api/auth/login`)
**Request:**
```http
POST /api/auth/login HTTP/1.1
Content-Type: application/json

{
  "email": "miller@evidenceguard.local",
  "password": "Password123!"
}
```
**Response (`200 OK`):**
```http
HTTP/1.1 200 OK
Set-Cookie: token=eyJhbGciOi...; Path=/; HttpOnly; SameSite=Lax

{
  "success": true,
  "message": "Login successful",
  "user": {
    "id": "66f4b321a09148d281ef40a1",
    "name": "Detective Miller",
    "email": "miller@evidenceguard.local",
    "role": "INVESTIGATOR"
  }
}
```

#### 3. Upload Evidence (`POST /api/evidence`)
**Request (`multipart/form-data`):**
```http
POST /api/evidence HTTP/1.1
Cookie: token=eyJhbGciOi...
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW

------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="name"

Surveillance Camera Corridor 4
------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="caseId"

EG-2026-0001
------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="type"

Video
------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="description"

Hallway CCTV footage 02:00-02:15 AM
------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="file"; filename="cctv_corridor.mp4"
Content-Type: video/mp4

[BINARY VIDEO DATA]
------WebKitFormBoundary7MA4YWxkTrZu0gW--
```
**Response (`201 Created`):**
```json
{
  "success": true,
  "message": "Evidence uploaded and block registered successfully.",
  "evidence": {
    "evidenceId": "EV-0001",
    "caseId": "EG-2026-0001",
    "name": "Surveillance Camera Corridor 4",
    "type": "Video",
    "fileName": "cctv_corridor.mp4",
    "fileSize": 4194304,
    "hash": "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    "status": "Pending",
    "createdAt": "2026-10-02T12:05:00.000Z"
  },
  "block": {
    "blockNumber": 1,
    "currentHash": "61a123f890b0e5138f2921a9bd2846f4142db4d4c51f33f07a48d88e67a123bc",
    "previousHash": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

#### 4. Verify Evidence (`POST /api/evidence/:id/verify`)
**Request:**
```http
POST /api/evidence/EV-0001/verify HTTP/1.1
Cookie: token=eyJhbGciOi...
Content-Type: multipart/form-data; boundary=----VerifyBoundary

------VerifyBoundary
Content-Disposition: form-data; name="file"; filename="candidate.mp4"
Content-Type: video/mp4

[BINARY DATA]
------VerifyBoundary--
```
**Response (`200 OK` - Match):**
```json
{
  "success": true,
  "result": "VERIFIED",
  "message": "Evidence integrity confirmed.",
  "evidenceId": "EV-0001",
  "caseId": "EG-2026-0001",
  "originalHash": "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
  "currentHash": "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
  "chainConsistent": true,
  "verificationId": "VR-0001",
  "verifiedAt": "2026-10-02T12:10:00.000Z",
  "verifiedBy": "Detective Miller"
}
```
*(On mismatch, `result: "TAMPERED"` is returned with HTTP 200, status is updated, and a `TAMPER_DETECTED` audit event is logged).*

#### 5. Generate QR Code (`GET /api/evidence/:id/qr`)
**Response (`200 OK`):**
```json
{
  "success": true,
  "evidenceId": "EV-0001",
  "caseId": "EG-2026-0001",
  "url": "http://localhost:3000/verify.html?caseId=EG-2026-0001",
  "pngDataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAADIEAYAAAD9x...",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 33 33\">...</svg>"
}
```

#### 6. Blockchain Validation (`POST /api/blockchain/validate`)
**Response (`200 OK`):**
```json
{
  "success": true,
  "valid": true,
  "blocksChecked": 5,
  "message": "BLOCKCHAIN INTEGRITY: VALID. All 5 blocks verified successfully.",
  "firstBrokenBlock": null,
  "issues": [],
  "validatedAt": "2026-10-02T12:15:00.000Z"
}
```

#### 7. Audit Chain Validation (`POST /api/audit/validate`)
**Response (`200 OK`):**
```json
{
  "success": true,
  "valid": true,
  "entriesChecked": 24,
  "message": "AUDIT CHAIN: VALID. All 24 entries verified successfully.",
  "firstBrokenSeq": null,
  "issues": [],
  "validatedAt": "2026-10-02T12:15:05.000Z"
}
```

#### 8. Public Verification Card (`GET /api/public/verify/:caseId`)
**Response (`200 OK` - Whitelisted fields only):**
```json
{
  "caseId": "EG-2026-0001",
  "evidenceId": "EV-0001",
  "type": "Video",
  "registeredAt": "2026-10-02T12:05:00.000Z",
  "status": "Verified",
  "statusAsOf": "2026-10-02T12:10:00.000Z",
  "hash": "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
  "isDemo": false,
  "note": "Public verification card. To confirm complete bit-level integrity, submit the physical file to an authorized investigator or verification terminal."
}
```

---

## 9. Installation & Prerequisites

### Prerequisites
- **Node.js**: v18.0.0 or later (v20+ recommended)
- **npm**: v9.0.0 or later
- **MongoDB**: Local MongoDB community server (v6.0+) running on port 27017, OR a MongoDB Atlas cloud URI. (For testing, an automated in-memory MongoDB is built-in).

### Installation Steps
```bash
# 1. Clone repository or extract archive
git clone https://github.com/example/evidenceguard.git
cd evidenceguard

# 2. Install dependencies
npm install

# 3. Create environment configuration
cp .env.example .env

# 4. Open .env and configure your values (see Environment Variables table below)
# At minimum, define MONGODB_URI and JWT_SECRET
```

---

## 10. Environment Variables

| Variable | Required | Default | Example Value | Description |
| :--- | :---: | :---: | :--- | :--- |
| `MONGODB_URI` | **Yes** | — | `mongodb://localhost:27017/evidenceguard` | Connection string for MongoDB |
| `TEST_MONGODB_URI` | No | — | `mongodb://localhost:27017/evidenceguard_test` | Dedicated database for `npm test`. Must contain `"test"` |
| `JWT_SECRET` | **Yes** | — | `a1b2c3d4e5f6...` (≥ 32 chars) | Secret key for signing and verifying JWTs |
| `PORT` | No | `3000` | `3000` | Port the Express server listens on |
| `NODE_ENV` | No | `development` | `development` or `production` | Environment mode |
| `PUBLIC_BASE_URL` | No | `http://localhost:3000` | `http://192.168.1.50:3000` | Base URL encoded into QR codes for mobile demos |
| `CLIENT_ORIGIN` | No | `""` | `https://evidence.police.gov` | CORS allowed origin for external web clients |
| `STORAGE_DRIVER` | No | `local` | `local` | Storage adapter (`local` filesystem storage) |
| `MAX_UPLOAD_MB` | No | `50` | `50` | Maximum file size in megabytes |
| `ADMIN_NAME` | No | `Administrator` | `Chief Admin` | Default admin name for `create-admin.js` |
| `ADMIN_EMAIL` | No | `admin@evidenceguard.local`| `admin@evidenceguard.local` | Default admin email for `create-admin.js` |
| `ADMIN_PASSWORD` | No | — | `ComplexAdminPass2026!` | Admin password for `create-admin.js` |
| `SEED_DEMO_PASSWORD`| No | Auto-generated | `DemoSecret2026!` | Password for demo accounts in `seed.js` |

> [!TIP]
> Generate a cryptographically secure 32+ character JWT secret with:
> `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

---

## 11. Running the Application

### 1. Initialize Admin or Seed Data
```bash
# Option A: Create a single clean Admin account
node scripts/create-admin.js

# Option B: Populate realistic demo accounts, files, and dual-chain blocks
node scripts/seed.js
```

### 2. Start the Server
```bash
# Start the live application server
npm start
# or: node server.js
```

Open your browser and navigate to: **`http://localhost:3000`**

---

## 12. Seeding & Demo Accounts

The project includes an intelligent, zero-hardcoded-credential seed script:
```bash
node scripts/seed.js
```
- **How Passwords Work:** Passwords are NEVER hardcoded in source control. If `SEED_DEMO_PASSWORD` is omitted from `.env`, `scripts/seed.js` cryptographically generates distinct, random 16-character passwords and prints them once in the terminal console.
- **Seeded Accounts Created:**
  - **Administrator:** `demo.admin@evidenceguard.local` (Role: `ADMIN`)
  - **Investigator:** `demo.investigator@evidenceguard.local` (Role: `INVESTIGATOR`)
  - **Viewer / Auditor:** `demo.viewer@evidenceguard.local` (Role: `VIEWER`)
- **Seeded Evidence & Blocks:**
  - `EV-0001` (`EG-2026-0001`): Hit-and-run traffic camera video (`Pending`)
  - `EV-0002` (`EG-2026-0002`): Audio wiretap recording (`Pending`)
  - `EV-0003` (`EG-2026-0003`): Incident crime scene photo (`Verified`)
  - `EV-0004` (`EG-2026-0004`): Financial spreadsheet (`Tampered` test case)
- Dual cryptographic chains (Block Ledger and Audit Trail) are automatically constructed, indexed, and confirmed `VALID` upon completion.

---

## 13. Testing Suite

The repository includes a comprehensive, automated test runner and end-to-end integration workflows.

### 1. Master Test Suite (`npm test`)
Runs all 15 sprint test suites in sequential order, enforcing stop-at-first-failure and displaying a unified summary table:
```bash
npm test
```
*Suites executed:*
1. `ids` (`test-ids.js`): Atomic sequence generation and counter uniqueness
2. `audit` (`test-audit.js`): Basic audit append-only log model pre-hooks
3. `auth` (`test-auth.js`): Registration, login, JWT cookies, and RBAC rejection
4. `evidence` (`test-evidence.js`): Multipart upload, SHA-256 derivation, duplicate prevention
5. `chain` (`test-chain.js`): Blockchain link verification, 1000-block performance test
6. `verify` (`test-verify.js`): Genuine vs. tampered file comparison and audit hooks
7. `list` (`test-list.js`): Multi-field catalog search, filtering, and projection safety
8. `public` (`test-public.js`): Public verification card and QR whitelist compliance
9. `dashboard` (`test-dashboard.js`): Aggregated statistics, caching, and role restrictions
10. `audit-api` (`test-audit-api.js`): Audit querying, filtering, and IP-masking
11. `audit-chain` (`test-audit-chain.js`): Cryptographic audit chain validation and tamper detection
12. `users` (`test-users.js`): User administration, role modification, self-demotion guards
13. `audit-coverage` (`test-audit-coverage.js`): End-to-end execution of all 13 canonical audit actions
14. `security` (`test-security.js`): OWASP security headers, NoSQL injection, path traversal
15. `errors` (`test-errors.js`): Error codes, rate limiting, and database disconnection resilience

*Safety Gate:* `npm test` checks that `TEST_MONGODB_URI` contains `"test"`. If an operational database is detected, it refuses to run unless `--force` is passed.

### 2. End-to-End Master Workflow Test (`npm run test:e2e`)
Executes the live 14-step presentation workflow end-to-end against live endpoints:
```bash
npm run test:e2e
```
*Steps validated:*
Register -> Login -> Dashboard stats -> Upload evidence -> Local SHA-256 match -> MongoDB document verified -> Blockchain block linkages verified -> Evidence list catalog shows record -> Verify genuine file (`VERIFIED`) -> Verify tampered file (`TAMPERED`) -> Audit trail contains all 5 evidence lifecycle events -> QR code generated and public view verified clean -> `BLOCKCHAIN INTEGRITY: VALID` -> `AUDIT CHAIN: VALID`.

### 3. Interactive Tamper Demonstration
Simulate active tampering with ledger records, observe the chain detect it, and automatically restore:
```bash
# Modify Block 1 currentHash
node scripts/tamper-demo.js change-block-hash --confirm

# Modify Block 1 previousHash
node scripts/tamper-demo.js change-previous-hash --confirm

# Modify Block 1 evidenceHash
node scripts/tamper-demo.js change-evidence-hash --confirm

# Delete Block 1 entirely
node scripts/tamper-demo.js delete-block --confirm
```
Each command validates that the chain turns `INVALID` at the exact block, restores the original state, and confirms both chains return to `VALID`.

---

## 14. Security Architecture

- **Server-Side SHA-256 Derivation:** Never trusts client hashes. The server streams the uploaded binary directly from disk through Node's `crypto.createHash('sha256')`.
- **Atomic Duplicate Guard:** A unique partial index on `Evidence.hash` prevents storing identical files, mitigating ledger bloat and duplicate registration attacks.
- **OWASP HTTP Headers (Helmet):** Enforces `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, strict `Content-Security-Policy`, and strips `X-Powered-By`.
- **Brute-Force & Rate Limiting:**
  - Login: 10 attempts per 15 minutes per IP.
  - Public Verification: 60 queries per 15 minutes per IP.
  - Evidence Verification: 60 attempts per 15 minutes per IP.
- **Strict Role-Based Authorization:** Action-based permission matrix strictly verified in backend middleware; UI elements are hidden or disabled for unauthorized roles.
- **NoSQL & Regex Injection Defense:** All user input is strictly validated via `express-validator`. Regex query parameters have special symbols escaped; object query expressions (`{$ne: null}`) are rejected with HTTP 400.
- **Path Traversal Guards:** File storage filenames are generated via UUID/timestamps with sanitized extensions; files are stored outside web-accessible roots and cannot be browsed directly.
- **Sensitive Key Masking:** Internal properties (`storageKey`, `filePath`, `passwordHash`, `ipAddress`) are systematically projected out of responses.

---

## 15. Cryptographic Foundations

### SHA-256 Explanation
SHA-256 (Secure Hash Algorithm 256-bit) is a cryptographic one-way hash function designed by the NSA. It transforms an input of arbitrary size into a fixed 256-bit (64-character hexadecimal) digest.
- **Deterministic:** The exact same input will always produce the exact same hash.
- **Avalanche Effect:** Changing even a single bit in the source file changes roughly 50% of the resulting hash characters completely unpredictably.
- **Pre-image Resistance:** It is computationally infeasible to reconstruct the original file from its hash.
- **Collision Resistance:** It is mathematically improbable to find two distinct files that yield the same SHA-256 digest.

### Hash-Chain Architecture & Mathematical Formula
In EvidenceGuard, each block cryptographically seals an evidence record by chaining its hash to the hash of the preceding block:

$$\text{CurrentBlockHash}_N = \text{SHA256}\Big(\text{JSON.stringify}\big([N, \text{evidenceId}, \text{caseId}, \text{evidenceHash}, \text{previousHash}_{N-1}, \text{timestampISO}]\big)\Big)$$

**Canonical Genesis Block ($N=0$):**
- $\text{blockNumber} = 0$
- $\text{previousHash} = \text{"0000000000000000000000000000000000000000000000000000000000000000"}$
- $\text{evidenceHash} = \text{"0000000000000000000000000000000000000000000000000000000000000000"}$

**Audit Trail Event Formula:**
$$\text{AuditEntryHash}_k = \text{SHA256}\Big(\text{JSON.stringify}\big([k, \text{eventId}, \text{timestampISO}, \text{action}, \text{userId}, \text{userName}, \text{role}, \text{evidenceId}, \text{caseId}, \text{description}, \text{prevHash}_{k-1}]\big)\Big)$$

If an attacker modifies a record in block $k$, $\text{CurrentBlockHash}_k$ changes. Consequently, block $k+1$'s stored $\text{previousHash}$ no longer matches, breaking the chain across all subsequent blocks.

---

## 16. QR Verification & Mobile Demo Setup

EvidenceGuard supports scanning QR codes on mobile devices to verify evidence in real time.
- **The Issue with `localhost`:** When testing QR codes on physical smartphones, the phone's browser cannot resolve `http://localhost:3000` because `localhost` refers to the phone itself.
- **Solution for Live Demos:**
  1. Find your computer's local network IP (e.g. `192.168.1.50`).
  2. In your `.env` file, configure:
     ```env
     PUBLIC_BASE_URL=http://192.168.1.50:3000
     ```
  3. Restart the server: `npm start`.
  4. Ensure your phone is connected to the same Wi-Fi network.
  5. Any generated QR code will now encode `http://192.168.1.50:3000/verify.html?caseId=EG-YYYY-NNNN`, allowing instantaneous scanning from iOS Camera or Google Lens.

---

## 17. Role Permission Matrix

| Operation / Capability | ADMIN | INVESTIGATOR | VIEWER |
| :--- | :---: | :---: | :---: |
| View Public Verification & About | ✔ | ✔ | ✔ |
| Authenticate / View Profile (`/me`) | ✔ | ✔ | ✔ |
| View Executive Dashboard Metrics | Full (inc. Users) | Evidence & Chain | Evidence & Trend |
| View Evidence Catalog & Details | ✔ | ✔ | ✔ |
| Upload & Register New Evidence | ✔ | ✔ | ✖ |
| Submit File for Verification | ✔ | ✔ | ✔ |
| View Verification Attempt History | ✔ | ✔ | ✔ |
| Generate & Export QR Code | ✔ | ✔ | ✔ |
| Soft-Delete Evidence Item | ✔ | ✖ | ✖ |
| View Blockchain Ledger | ✔ | ✔ | ✔ |
| Trigger Blockchain Validation | ✔ | ✖ | ✖ |
| View Audit Trail Records | Full (with IPs) | Anonymized (no IPs) | ✖ |
| Trigger Audit Chain Validation | ✔ | ✖ | ✖ |
| Access User Management UI | ✔ | ✖ | ✖ |
| Create User / Modify Roles | ✔ | ✖ | ✖ |
| Deactivate User Account | ✔ | ✖ | ✖ |

---

## 18. Screenshots Section

Screenshots documenting all application features are stored in the [`docs/screenshots/`](file:///c:/Users/madhu/.gemini/antigravity/scratch/EvidenceGuard/docs/screenshots/) directory:

- `01-landing-page.png`: Public Landing Page with interactive pipeline animation and hero CTA
- `02-login-screen.png`: Secure Authentication & Registration modal
- `03-dashboard-overview.png`: Executive Protection Dashboard with KPI cards, 7-day trend chart, and real-time ledger health
- `04-evidence-registration.png`: Drag-and-drop Evidence Upload with live client-side SHA-256 calculation
- `05-evidence-catalog.png`: Searchable Evidence Grid with type/status filters and status tags
- `06-verification-verified.png`: Verification portal confirming genuine evidence match (VERIFIED banner)
- `07-verification-tampered.png`: Verification portal detecting altered content (TAMPERED alert)
- `08-blockchain-ledger.png`: Sequential block viewer showing cryptographic hashes and previousHash links
- `09-audit-trail.png`: Append-only audit log with sequential event numbering and cryptographic signatures
- `10-qr-public-verify.png`: Generated QR code and public verification card (mobile-friendly)
- `11-user-management.png`: Role-Based Access Control administration (Admin only)
- `12-tamper-detection-demo.png`: Broken chain visual alert showing detected tampering at specific block

---

## 19. System Limitations

In adherence to strict academic and engineering transparency, EvidenceGuard acknowledges the following design boundaries:

1. **Centralized Ledger Storage:** The ledger blocks and audit logs live in the same MongoDB instance as operational records. It is a single-node prototype, not a decentralized distributed consensus network.
2. **Database Administrator Compromise:** A database administrator with root access who selectively recomputes downstream SHA-256 hashes could theoretically rewrite both the block chain and the audit chain.
3. **Origin Authenticity vs. Integrity:** SHA-256 hashes prove that a file matches what was registered at intake. They do NOT prove that the file was authentic when initially gathered in the physical world, nor do they prove who originally created it.
4. **Standard Server Storage:** Digital files are stored on server disk storage, not inside a certified Hardware Security Module (HSM) or hardware-enforced Write Once Read Many (WORM) storage appliance.
5. **No Automated Password Reset Flow:** Password reset currently requires administrative database intervention; there is no automated email-based or self-service password recovery flow implemented in this prototype.
6. **Sequential Case ID Guessability:** The public QR verification endpoint uses sequential Case IDs (`EG-YYYY-NNNN`), which could be sequentially enumerated without external rate limiting or random GUID identifiers.

---

## 20. Future Scope & Roadmap

1. **Digital Signatures:** Asymmetric key signing (ECDSA / Ed25519) tying evidence to individual verified officers.
2. **Real Blockchain (Ethereum / Solidity):** Decentralized smart contracts to anchor block roots onto a public ledger.
3. **IPFS Distributed Storage:** Decentralized peer-to-peer content addressing for tamper-proof storage resilience.
4. **Cloud Storage WORM Policy:** AWS S3 Object Lock and Azure Immutable Blobs with legal hold retention.
5. **Advanced Chain of Custody:** Multi-party transfer logs, custodian signatures, and physical laboratory tracking.
6. **Automated Notifications:** Instant SIEM, email, and SMS alerts when tamper detections occur.
7. **AI Forensic Classification:** Automated content tagging, face redaction, and forensic triage models.
8. **Forensic Analysis Tool Integration:** Direct export/import connectors for Autopsy, Volatility, and EnCase disk images.
9. **Multi-Organization Support:** Multi-tenant isolation and secure cross-agency evidence sharing.
10. **Hardware Security Modules (HSM):** FIPS 140-2 Level 3 physical cryptographic token support for key management.

---

## License & Academic Disclaimer
Developed as an engineering capstone and cybersecurity prototype demonstration.  
Licensed under the ISC License.
