# EvidenceGuard – 5-Minute Live Presentation & Demo Script

**Project Title:** EvidenceGuard — Digital Evidence Protection, Verification & Chain-of-Custody System  
**Presentation Duration:** Exactly 5 Minutes (+ 2 Min Bonus & Viva Q&A)  
**Target Audience:** Academic Evaluators, Forensic Investigators, Technical Panel  
**Prototype Disclaimer:** *"Blockchain-inspired hash-chain prototype; not a real blockchain."*

---

## Pre-Demo Checklist & Setup (2 Minutes Before Demo)

1. **Start the Live Server:**
   ```bash
   npm start
   # Server running on http://localhost:3000
   ```
2. **Seed Clean Demo Data (if not already done):**
   ```bash
   node scripts/seed.js
   # Notes the generated credentials or uses SEED_DEMO_PASSWORD in .env
   ```
3. **Files Ready in `./demo-files/` (or on Desktop for Quick Drag-and-Drop):**
   - **Original Genuine File:** `demo-files/case1_surveillance.mp4` (or `sample_report.txt`)
   - **Tampered Altered File:** `demo-files/case1_surveillance_tampered.mp4` (or `sample_report_tampered.txt`)
4. **Accounts Ready:**
   - **Investigator Account:** `demo.investigator@evidenceguard.local` (Password from seed output or `.env`)
   - **Admin Account:** `demo.admin@evidenceguard.local` (For ledger validation & user management)
5. **Mobile Phone Ready:**
   - Phone connected to same Wi-Fi network; `.env` has `PUBLIC_BASE_URL=http://<YOUR_LAN_IP>:3000`.

---

## Minute-by-Minute Presentation Timeline

### Minute 1: The Problem, Philosophy & Authentication (0:00 – 1:00)
- **Visual:** Open browser at `http://localhost:3000/index.html` (Landing Page).
- **Spoken Script:**
  > *"Good morning, respected professors. In digital forensics and criminal jurisprudence, electronic evidence is fragile. A surveillance video, audio wiretap, or hard drive image can be trivially modified or swapped without physical traces. If the chain of custody is broken, crucial evidence is dismissed in court.*
  > 
  > *EvidenceGuard solves this by pairing streaming SHA-256 cryptographic hashing with an immutable hash-linked block ledger and a cryptographically chained audit trail. Notice the visual workflow here: Digital Evidence &rarr; SHA-256 Hash &rarr; Secure Storage &rarr; Hash Chain &rarr; Verification &rarr; Verified or Tampered.*
  > 
  > *Let's log in as Detective Miller."*
- **Action:** Click **"Open Dashboard"** (or Login). Log in with `demo.investigator@evidenceguard.local`.

---

### Minute 2: Executive Dashboard & Evidence Intake (1:00 – 2:00)
- **Visual:** Lands on `http://localhost:3000/dashboard.html`.
- **Spoken Script:**
  > *"We are on the Protection Dashboard. Here we see live metrics: total registered evidence items, verified items, pending items, total blockchain blocks, and a 7-day verification activity chart. Notice the real-time Blockchain Integrity indicator showing VALID.*
  > 
  > *Now let's register fresh evidence collected at a crime scene."*
- **Action:**
  1. Click **"Upload Evidence"** (navigates to `evidence.html` or modal).
  2. Drag and drop `case1_surveillance.mp4` into the dropzone.
  3. Enter Name: `"East Corridor CCTV"`, Case ID: `"EG-2026-0001"`, Type: `"Video"`.
  4. Point to the client-side calculated hash: *"Notice the browser immediately computed the SHA-256 digest using the Web Crypto API before transmission."*
  5. Click **"Register Evidence"**.
  6. Success toast appears! Evidence is assigned `EV-0005` (or sequential next ID).

---

### Minute 3: Database & Blockchain Ledger Verification (2:00 – 3:00)
- **Visual:** Switch briefly to MongoDB Compass / Atlas or open `blockchain.html`.
- **Spoken Script:**
  > *"When the file reached the server, EvidenceGuard independently re-computed the SHA-256 digest directly from the incoming stream—enforcing a strict Zero-Trust boundary against client tampering.*
  > 
  > *Let's inspect the underlying storage and the blockchain ledger."*
- **Action:**
  1. Show MongoDB record (Compass or CLI):
     - **Database:** `evidenceguard` &rarr; **Collection:** `evidence` &rarr; Filter: `{ evidenceId: "EV-0001" }`.
     - Point out: `hash`, `status: "Pending"`, and `storageKey` (which is never exposed publicly).
  2. Switch to browser tab: `http://localhost:3000/blockchain.html`.
     - Show Block #1:
     - Point out `previousHash` linking to Block #0 (Genesis block `00000000...`).
     - Point out `currentHash` sealing the evidence ID, case ID, evidence hash, and timestamp.

---

### Minute 4: The Core Test — Bit-Level Verification (3:00 – 4:00)
- **Visual:** Navigate to `http://localhost:3000/verify.html`.
- **Spoken Script:**
  > *"Now comes the critical forensic test: 6 months later, this evidence is presented in court. Has it been altered?*
  > 
  > *First, we submit the authentic, untouched file."*
- **Action (Genuine File):**
  1. Select or enter Case ID `EG-2026-0001` (or Evidence ID).
  2. Drop the original `case1_surveillance.mp4`.
  3. Click **"Verify Integrity"**.
  4. **Result:** Big green badge appears: **"VERIFIED — Evidence integrity confirmed."**
  5. Point out: Submitted hash matches registered hash byte-for-byte; `chainConsistent: true`.
- **Action (Tampered File):**
  > *"Now, what if a malicious insider or malware altered just one single byte in that video?"*
  1. Drop `case1_surveillance_tampered.mp4`.
  2. Click **"Verify Integrity"**.
  3. **Result:** High-visibility red banner pulses: **"TAMPERED — Hash mismatch detected!"**
  4. Point out: The submitted hash completely diverged due to the cryptographic avalanche effect.
  5. Click **"View in Audit Trail"** &rarr; Shows `TAMPER_DETECTED` event logged with timestamp, user, and IP address.

---

### Minute 5: Mobile QR Verification & Chain Validation (4:00 – 5:00)
- **Visual:** `evidence.html` QR modal & `blockchain.html` validator.
- **Spoken Script:**
  > *"Defense attorneys or courtroom auditors need to verify evidence without logging into our police database.*
  > 
  > *We generate a public verification QR code."*
- **Action:**
  1. Click **"Generate QR"** on the evidence item.
  2. Scan the QR code using a smartphone camera (or open the target URL in an incognito tab).
  3. Display the **Public Verification Card**:
     - Shows Case ID, Evidence ID, registered timestamp, current status, and SHA-256.
     - Note the security boundary: No file paths, no internal storage keys, and no officer names are leaked.
  4. Return to browser: Log in as Admin (`demo.admin@evidenceguard.local`).
  5. Open `blockchain.html` and click **"Validate Entire Ledger"**.
  6. Result appears: **"BLOCKCHAIN INTEGRITY: VALID — All blocks verified."**
  7. Open `audit.html` and click **"Validate Audit Chain"**:
  8. Result appears: **"AUDIT CHAIN: VALID — All sequential event signatures verified."**
  > *"Thank you. The core application is 100% complete, tested, and operational. We welcome questions from the panel."*

---

## Bonus Segment: Deliberate Tampering & Live Recovery (2 Minutes)

If the panel asks: *"How do we know the blockchain validation actually works when someone hacks the database?"*

1. **Execute deliberate database tampering via script:**
   ```bash
   node scripts/tamper-demo.js change-block-hash --confirm
   ```
2. **Refresh the Blockchain page (`blockchain.html`) or click "Validate Ledger Now":**
   - The validation modal turns deep red with a warning icon:
   - **`BLOCKCHAIN INTEGRITY: INVALID`**
   - **`First Broken Block: #1`**
   - **`Issue: Stored currentHash does not match recomputed SHA-256 hash`**
3. **Show restoration:**
   - Point out that the script restored the block:
     `Restored Blockchain Result: BLOCKCHAIN INTEGRITY: VALID`
   - Re-validate on the web UI &rarr; Returns **VALID** again!

---

## Contingency & Backup Plans

| Step | Risk / What If | Backup Procedure |
| :--- | :--- | :--- |
| **Wi-Fi Fails** | Cannot reach server or internet is lost | Server runs entirely on `localhost:3000`; everything is offline and self-contained. Keep offline demo active. |
| **Mobile QR Fails** | Phone cannot resolve LAN IP or network isolates devices | Click the "Copy Link" button beside the QR code and open it in a secondary browser window or Chrome Incognito tab. It demonstrates the exact same unauthenticated public verification card. |
| **MongoDB Stops** | MongoDB process crashes or port conflict | The frontend displays a friendly amber toast: *"Service temporarily unavailable (HTTP 503)"*. Restart MongoDB with `mongod` or run tests with built-in in-memory fallback. |
| **Browser Freezes** | Browser tab crashes | Open an incognito window, navigate to `http://localhost:3000/dashboard.html`. All state is persisted in MongoDB and will restore immediately. |

---

## 10 Likely Viva Questions with Short, Confident Answers

### 1. Why SHA-256 instead of MD5 or SHA-1?
> *"MD5 and SHA-1 suffer from well-documented collision vulnerabilities (e.g. Google's SHAttered attack on SHA-1 in 2017). SHA-256 is an NSA-designed cryptographic hash function under NIST FIPS 180-4 with a 256-bit key space ($2^{256}$ possibilities). It has zero known practical collision attacks and is the legal forensic gold standard."*

### 2. What is a hash collision, and could two evidence files have the same hash?
> *"A hash collision occurs when two distinct inputs yield the identical hash output. For SHA-256, finding a collision would require approximately $2^{128}$ computations under the birthday paradox—which would take millions of years across all supercomputers on Earth. For all practical forensic purposes, collisions are impossible."*

### 3. Why recompute the hash on the server if the client already hashed it?
> *"Zero-Trust security architecture. The frontend runs in an untrusted client environment. An attacker could use Postman or tamper with JavaScript to send a malicious file along with a fake hash string. Server-side streaming recomputation guarantees that the hash recorded in the ledger corresponds bit-for-bit to the exact bytes written to storage."*

### 4. Why is this called a 'prototype' and not a real blockchain?
> *"A production blockchain (like Ethereum or Bitcoin) requires a decentralized peer-to-peer network, consensus algorithms (Proof-of-Work or Proof-of-Stake), and distributed validator nodes. EvidenceGuard uses a single-node MongoDB database with cryptographic block chaining (`previousHash`). While it demonstrates sequential cryptographic immutability, a root database administrator could theoretically rewrite downstream hashes without decentralized consensus."*

### 5. What kind of tampering does EvidenceGuard NOT detect?
> *"EvidenceGuard detects any tampering that occurs after registration into the system. However, it cannot detect tampering that occurred in the physical world before upload. If a corrupt officer alters a photo on a camera before uploading it, EvidenceGuard will faithfully seal the already-tampered file. Mitigating this requires pre-intake digital signatures (part of our future scope)."*

### 6. How is Role-Based Access Control (RBAC) enforced?
> *"RBAC is enforced at the Express router level via middleware (`authenticate` and `authorizeAction`). User roles are embedded in signed JWT tokens stored in `HttpOnly` cookies. If a `VIEWER` attempts to `POST /api/evidence` or `DELETE /api/evidence/:id`, the backend rejects the request with HTTP 403 Forbidden, regardless of any frontend UI state."*

### 7. How does the system prevent duplicate uploads?
> *"EvidenceGuard has a unique partial database index on `Evidence.hash` where `isDeleted: false`. When a file is uploaded, the server derives its SHA-256. If that hash already exists for an active record, the database enforces an atomic constraint, rejecting the upload with HTTP 409 Conflict and returning the existing Evidence ID."*

### 8. What happens when an evidence record is deleted?
> *"EvidenceGuard only permits soft deletion by Admins (`DELETE /api/evidence/:id`). The physical file is purged from disk storage, and the record is marked `isDeleted: true`. Crucially, the blockchain block is never deleted—it remains in the ledger to preserve the `previousHash` link and cryptographic chain continuity."*

### 9. How does the audit chain differ from the evidence blockchain?
> *"The evidence blockchain links digital artifacts to block numbers. The audit chain is a distinct, append-only security log that cryptographically links every action (`UPLOAD`, `LOGIN`, `VERIFY`, etc.) using sequential integers (`seq`), timestamps, and `prevHash`. Mongoose pre-hooks block `updateOne` and `deleteOne`, ensuring that even administrative actions leave an immutable trail."*

### 10. If you had another month to work on this, what would you add next?
> *"Our top three roadmap items from our Future Scope are: (1) Asymmetric Digital Signatures (Ed25519) tying evidence to individual officer keypairs; (2) Anchoring daily root hashes onto a public Ethereum testnet smart contract; and (3) Cloud WORM storage integration using AWS S3 Object Lock for legal hold compliance."*
