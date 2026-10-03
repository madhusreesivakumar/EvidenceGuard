# EvidenceGuard Cryptographic Key & Secret Inventory
**Sprint 16: KMS / HSM Integration Architecture**

This inventory catalogs every cryptographic key, token, and secret credential utilized across the EvidenceGuard platform, classifying each according to its security boundary, lifecycle, and migration path into a Hardware Security Module (HSM) or Cloud Key Management Service (KMS).

---

## 1. Executive Classification Taxonomy

Each asset is categorized into one of three architectural classifications:
1. **Can Move into KMS/HSM (`KMS_MIGRATABLE`)**:
   - The private key material never leaves the secure cryptographic boundary.
   - Operations (encryption, decryption, signing, key derivation) are executed inside the KMS/HSM via RPC/PKCS#11.
   - Access is audited, hardware-enforced, and subject to key rotation policies.
2. **Must Stay a Secret (`SECRET_STORE`)**:
   - Authentication tokens or passwords used to communicate with external APIs, databases, or third-party gateways.
   - These cannot be executed as KMS keys because the external services require the raw secret for authentication.
   - Managed via secure Secrets Loaders (e.g., AWS Secrets Manager, Azure Key Vault Secrets, HashiCorp Vault, Kubernetes Secret file mounts) rather than plain environment variables.
3. **Replaceable / Ephemeral (`REPLACEABLE`)**:
   - Credentials that can be entirely eliminated in favor of Cloud Identity (IAM roles, Managed Identities, Workload Identity federation) or client-side non-extractable keys.

---

## 2. Complete Inventory Table

| Asset Identifier | Current Storage / Format | Purpose | Classification | Target in Sprint 16 (KMS / HSM) | Threat Mitigation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`STORAGE_MASTER_KEY`** (Storage KEK) | Env variable (`base64` 32-byte AES) | Key Encryption Key (KEK) wrapping per-evidence DEKs (Sprint 11). | **KMS_MIGRATABLE** | Moved to KMS/HSM as `STORAGE_KEK`. All envelope wrap/unwrap calls bind contextual authenticated data (`evidenceId`, `orgId`). | Eliminates disk/RAM exposure of master key; prevents cross-record key swapping. |
| **`JWT_SECRET`** | Env variable (`utf8` string) | Symmetric HS256 signing of session tokens. | **KMS_MIGRATABLE** | Replaced by asymmetric ECDSA P-256 (`JWT_KEY`) signed inside KMS/HSM. Public keys cached in memory for zero-latency local verification. | Eliminates symmetric key theft; prevents offline forgery of authentication tokens. |
| **`NOTARY_KEY`** (Ledger & Audit Notary) | *New in Sprint 16* | Asymmetric ECDSA P-256 key signing periodic cryptographic checkpoints of the ledger & audit chains. | **KMS_MIGRATABLE** | Generated and held non-extractable inside KMS/HSM (`NOTARY_KEY`). Signs state checkpoints { `ledgerHeadHash`, `auditHeadHash`, `timestamp` }. | Detects chain truncation or silent rollbacks even if the MongoDB replica is compromised. |
| **`ANCHOR_PRIVATE_KEY`** (Ethereum Signer) | Env variable (secp256k1 hex private key) | Signs Ethereum smart contract transactions anchoring Merkle roots (Sprint 10). | **KMS_MIGRATABLE** (Conditional) / **SECRET_STORE** | Migrated to KMS when provider supports secp256k1 (`ECC_SECG_P256K1` in AWS KMS); otherwise retained in Secret Store with hardware signing proxy. | Prevents exposure of blockchain gas funding key and unauthorized contract calls. |
| **`MONGODB_URI`** | Env variable (connection string with credentials) | Authenticates the backend to the MongoDB database cluster. | **SECRET_STORE** / **REPLACEABLE** | In local/Docker: injected via Secrets Loader. In production AWS/Azure: replaceable via IAM Database Authentication / Managed Identity. | Prevents exposure in shell history, process tables (`/proc`), and application stack traces. |
| **`SMTP_USER` & `SMTP_PASS`** | Env variables (`utf8` strings) | Authenticates with the outbound SMTP relay (Sprint 13). | **SECRET_STORE** | Managed via Secrets Loader (AWS Secrets Manager, Azure Key Vault, or mounted secret files). | Protects email notification infrastructure against unauthorized spam / relay abuse. |
| **`TWILIO_AUTH_TOKEN` & `TWILIO_ACCOUNT_SID`** | Env variables (`utf8` strings) | Authenticates with Twilio REST API for SMS dispatches (Sprint 13). | **SECRET_STORE** | Managed via Secrets Loader. Injected dynamically at runtime; never checked into repository. | Prevents toll fraud, SMS spoofing, and lateral movement. |
| **`SOFTHSM_PIN` / `PKCS11_PIN`** | Env variable / secret file | User PIN authenticating session pool to the SoftHSM2 cryptographic token. | **SECRET_STORE** | Loaded into memory only during PKCS#11 session initialization; memory zeroed after use. Never logged. | Protects HSM slot access; brute-force protection enforced by token hardware logic. |
| **`S3_ACCESS_KEY_ID` & `S3_SECRET_ACCESS_KEY`** | Env variables (`utf8` strings) | Authenticates to AWS S3 / MinIO remote object store (Sprint 11). | **REPLACEABLE** / **SECRET_STORE** | In production, replaced by AWS IAM Instance Profile / Pod Identity (zero long-lived credentials). In dev/MinIO: loaded via Secrets Loader. | Eliminates static cloud credentials from application hosts. |
| **User Signing Keys** (Officer ECDSA P-256) | Browser IndexedDB (non-extractable CryptoKey) | Digital signatures on evidence custody transfers and inspections (Sprint 9). | **CLIENT_HSM_EMULATION** | Stored client-side inside Web Crypto API hardware-backed storage (Secure Enclave / TPM / Android Keystore). Server only holds public key. | Server compromise cannot forge an investigator's cryptographic signature. |

---

## 3. Cryptographic Binding & Contextual AAD

To prevent **Ciphertext Replay & Confused Deputy Attacks**, any key wrapped by the `KeyProvider` must bind cryptographic Additional Authenticated Data (AAD):
- Context:
  ```json
  {
    "orgId": "tenant-slug",
    "evidenceId": "EV-YYYY-NNNN",
    "purpose": "EVIDENCE_ENVELOPE_DEK"
  }
  ```
- **Security Guarantee**: A wrapped DEK from Organization A cannot be unwrapped under Organization B, nor can a DEK from Evidence Item 1 be transplanted onto Evidence Item 2. Tampering with either the ciphertext or the context parameters results in instant authentication failure (`KMS_UNAVAILABLE` or `AUTHENTICATION_FAILED`).

---

## 4. Key Lifecycle & Rotation Policy

| Key Identifier | Algorithm | Rotation Schedule | Retirement Procedure |
| :--- | :--- | :--- | :--- |
| `STORAGE_KEK` | AES-256 (GCM / KeyWrap) | 90 Days / Re-wrap on demand | Old versions remain accessible for decryption; new uploads use latest version. Upon two-person approval, `scripts/rewrap-keys.js` re-wraps all DEKs and disables retired versions. |
| `JWT_KEY` | ECDSA P-256 (SHA-256) | 30 Days | Two versions active concurrently: new tokens signed with vCurrent; vPrevious accepted for verification until expiration window (8 hours) closes. |
| `NOTARY_KEY` | ECDSA P-256 (SHA-256) | 180 Days | New checkpoint signed with current active key; public keys preserved in verification ring for historical verification. |
| `ANCHOR_KEY` | secp256k1 (Keccak-256) | 365 Days / On Admin Change | Admin contract transfers `ANCHORER_ROLE` to newly rotated public address. |

---

## 5. Security Invariants
1. **Zero Raw Key Logging**: No key provider may ever log raw key bytes, plaintext data keys, or HSM token PINs.
2. **Fail Closed**: In the event of KMS/HSM communication disruption or timeout (> 5000ms), all cryptographic operations fail closed (`HTTP 503 KMS_UNAVAILABLE`). The system **never** falls back to insecure local or unencrypted operations.
3. **Production Enforcement**: Production environments (`NODE_ENV=production`) strictly refuse to boot if `KMS_PROVIDER=local` unless `ALLOW_LOCAL_KMS=true` is explicitly provided.
