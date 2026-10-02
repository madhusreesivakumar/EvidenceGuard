/**
 * EvidenceGuard – Client-Side Cryptographic Key Management
 * Uses Web Crypto API for ECDSA P-256 key generation, PBKDF2 passphrase encryption,
 * AES-256-GCM local storage in IndexedDB, and backup export/restore.
 *
 * The server NEVER receives or stores private keys or passphrases.
 */
'use strict';

const EG_KEYSTORE = {
  DB_NAME: 'evidenceguard_keystore',
  DB_VERSION: 1,
  STORE_NAME: 'officer_keys',

  openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'keyId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async saveKey(record) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async getKey(keyId) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.get(keyId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllKeys() {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async deleteKey(keyId) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.delete(keyId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
};

// ─── Helpers: ArrayBuffer <-> Hex / Base64 ───────────────────────────────────

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

function bufToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ─── Cryptographic Derivations ────────────────────────────────────────────────

async function deriveAesKey(passphrase, saltBuffer, iterations = 600000) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate a new ECDSA P-256 key, encrypt with passphrase, and register with server.
 */
async function generateAndRegisterKey(label, passphrase) {
  // 1. Generate ECDSA P-256 KeyPair
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true, // temporarily extractable to encrypt and save
    ['sign', 'verify']
  );

  // 2. Export Private Key (PKCS8) and Public Key (JWK)
  const pkcs8Buf = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  // 3. Encrypt PKCS8 with passphrase (PBKDF2 + AES-256-GCM)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(passphrase, salt, 600000);

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    pkcs8Buf
  );

  // 4. Request challenge nonce from server
  const chRes = await EG.api.get('/api/keys/challenge');
  if (!chRes.success || !chRes.challenge) {
    throw new Error(chRes.message || 'Failed to acquire registration challenge');
  }

  // 5. Sign the challenge with the new private key (Proof of Possession)
  const enc = new TextEncoder();
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    keyPair.privateKey,
    enc.encode(chRes.challenge)
  );
  const signatureBase64 = bufToBase64(sigBuf);

  // 6. Register public key on the server
  const regRes = await EG.api.post('/api/keys', {
    label,
    publicKeyJwk,
    challenge: chRes.challenge,
    signature: signatureBase64
  });

  if (!regRes.success || !regRes.key) {
    throw new Error(regRes.message || 'Server rejected key registration');
  }

  const { keyId, fingerprint } = regRes.key;

  // 7. Save encrypted blob to IndexedDB
  await EG_KEYSTORE.saveKey({
    keyId,
    label,
    fingerprint,
    publicKeyJwk,
    saltHex: bufToHex(salt),
    ivHex: bufToHex(iv),
    ciphertextBase64: bufToBase64(ciphertextBuf),
    iterations: 600000,
    createdAt: new Date().toISOString()
  });

  return regRes.key;
}

/**
 * Decrypts a private key from IndexedDB and imports it as NON-EXTRACTABLE for signing.
 */
async function loadPrivateKeyForSigning(keyId, passphrase) {
  const record = await EG_KEYSTORE.getKey(keyId);
  if (!record) {
    throw new Error('Key not found in local browser storage. You may need to restore from backup.');
  }

  const saltBuf = hexToBuf(record.saltHex);
  const ivBuf = hexToBuf(record.ivHex);
  const ciphertextBuf = base64ToBuf(record.ciphertextBase64);

  const aesKey = await deriveAesKey(passphrase, saltBuf, record.iterations || 600000);

  let pkcs8Buf;
  try {
    pkcs8Buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBuf },
      aesKey,
      ciphertextBuf
    );
  } catch (err) {
    throw new Error('Incorrect passphrase. Could not decrypt cryptographic key.');
  }

  // Import as NON-extractable
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8Buf,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, // non-extractable!
    ['sign']
  );
}

// ─── UI Controller for keys.html ─────────────────────────────────────────────

async function initKeysPage() {
  const tableBody = document.getElementById('keysTableBody');
  const countIndicator = document.getElementById('keyLimitIndicator');
  const btnOpenModal = document.getElementById('btnOpenGenerateModal');
  const modal = document.getElementById('generateKeyModal');
  const form = document.getElementById('generateKeyForm');
  const btnCancel = document.getElementById('btnCancelGenKey');
  const progress = document.getElementById('genKeyProgress');

  const revokeModal = document.getElementById('revokeKeyModal');
  const revokeForm = document.getElementById('revokeKeyForm');
  const btnCancelRevoke = document.getElementById('btnCancelRevoke');
  const revokeKeyIdInput = document.getElementById('revokeKeyId');

  const btnRestore = document.getElementById('btnRestoreBackup');
  const restoreInput = document.getElementById('restoreFileInput');

  async function loadKeys() {
    try {
      const res = await EG.api.get('/api/keys');
      if (!res.success) throw new Error(res.message);

      const serverKeys = res.keys || [];
      const localKeys = await EG_KEYSTORE.getAllKeys();
      const localKeyIds = new Set(localKeys.map(k => k.keyId));

      const activeCount = serverKeys.filter(k => k.status === 'active').length;
      if (countIndicator) {
        countIndicator.textContent = `Active keys: ${activeCount} / 5`;
      }

      if (serverKeys.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">
              No cryptographic keys registered yet. Click "Generate New Key" to create your first key.
            </td>
          </tr>
        `;
        return;
      }

      tableBody.innerHTML = serverKeys.map(k => {
        const isLocal = localKeyIds.has(k.keyId);
        const isRevoked = k.status === 'revoked';
        const fpShort = k.fingerprint ? `${k.fingerprint.substring(0, 8)}...${k.fingerprint.substring(k.fingerprint.length - 8)}` : '-';
        const fpFull = k.fingerprint || '';
        const createdDate = new Date(k.createdAt).toLocaleDateString();

        return `
          <tr data-key-id="${k.keyId}">
            <td><strong>${escapeHtml(k.label)}</strong></td>
            <td><code style="font-size: 0.8rem; color: var(--accent-cyan);">${k.keyId.substring(0, 8)}...</code></td>
            <td>
              <span class="mono" title="${fpFull}" style="font-size: 0.82rem; cursor: pointer;" onclick="navigator.clipboard.writeText('${fpFull}'); EG.utils.toast('Fingerprint copied!', 'info');">
                ${fpShort} 📋
              </span>
            </td>
            <td><span style="font-size: 0.8rem; color: var(--text-muted);">${k.algorithm || 'ECDSA-P256'}</span></td>
            <td>
              <span class="badge ${isRevoked ? 'badge-tampered' : 'badge-verified'}">
                ${isRevoked ? 'Revoked' : 'Active'}
              </span>
            </td>
            <td style="font-size: 0.85rem; color: var(--text-muted);">${createdDate}</td>
            <td>
              <span style="font-size: 0.82rem; color: ${isLocal ? 'var(--status-verified)' : 'var(--text-muted)'};">
                ${isLocal ? '✔ This Device' : '✖ External'}
              </span>
            </td>
            <td style="text-align: right;">
              <div style="display: inline-flex; gap: 6px;">
                ${isLocal ? `<button class="btn btn-secondary btn-sm" onclick="exportKeyBackup('${k.keyId}')" title="Download encrypted backup">💾 Backup</button>` : ''}
                ${!isRevoked ? `<button class="btn btn-danger btn-sm" onclick="openRevokeModal('${k.keyId}')">Revoke</button>` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');

    } catch (err) {
      console.error(err);
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--status-tampered); padding: 2rem;">
            Failed to load keys: ${escapeHtml(err.message)}
          </td>
        </tr>
      `;
    }
  }

  // Modal open/close
  if (btnOpenModal) {
    btnOpenModal.onclick = () => {
      form.reset();
      progress.style.display = 'none';
      modal.style.display = 'flex';
    };
  }
  if (btnCancel) {
    btnCancel.onclick = () => { modal.style.display = 'none'; };
  }

  // Form submission
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const label = document.getElementById('keyLabel').value.trim();
      const pass = document.getElementById('keyPassphrase').value;
      const passConf = document.getElementById('keyPassphraseConfirm').value;

      if (pass !== passConf) {
        EG.utils.toast('Passphrases do not match.', 'error');
        return;
      }

      try {
        progress.style.display = 'block';
        document.getElementById('btnSubmitGenKey').disabled = true;

        await generateAndRegisterKey(label, pass);

        EG.utils.toast('Key generated and registered successfully!', 'success');
        modal.style.display = 'none';
        loadKeys();
      } catch (err) {
        EG.utils.toast(err.message || 'Key registration failed', 'error');
      } finally {
        progress.style.display = 'none';
        document.getElementById('btnSubmitGenKey').disabled = false;
      }
    };
  }

  // Revocation
  window.openRevokeModal = (keyId) => {
    revokeKeyIdInput.value = keyId;
    document.getElementById('revokeReason').value = '';
    revokeModal.style.display = 'flex';
  };

  if (btnCancelRevoke) {
    btnCancelRevoke.onclick = () => { revokeModal.style.display = 'none'; };
  }

  if (revokeForm) {
    revokeForm.onsubmit = async (e) => {
      e.preventDefault();
      const keyId = revokeKeyIdInput.value;
      const reason = document.getElementById('revokeReason').value.trim();

      try {
        const res = await EG.api.post(`/api/keys/${keyId}/revoke`, { reason });
        if (!res.success) throw new Error(res.message);

        EG.utils.toast('Key revoked successfully.', 'info');
        revokeModal.style.display = 'none';
        loadKeys();
      } catch (err) {
        EG.utils.toast(err.message || 'Revocation failed', 'error');
      }
    };
  }

  // Export Backup
  window.exportKeyBackup = async (keyId) => {
    const record = await EG_KEYSTORE.getKey(keyId);
    if (!record) {
      EG.utils.toast('Key record not found in local browser storage.', 'error');
      return;
    }

    const backupData = {
      app: 'EvidenceGuard',
      version: '1.0',
      keyId: record.keyId,
      label: record.label,
      fingerprint: record.fingerprint,
      publicKeyJwk: record.publicKeyJwk,
      saltHex: record.saltHex,
      ivHex: record.ivHex,
      ciphertextBase64: record.ciphertextBase64,
      iterations: record.iterations || 600000,
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evidenceguard-key-${record.keyId.substring(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    EG.utils.toast('Encrypted backup downloaded.', 'success');
  };

  // Restore Backup
  if (btnRestore && restoreInput) {
    btnRestore.onclick = () => restoreInput.click();

    restoreInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.keyId || !data.ciphertextBase64 || !data.saltHex || !data.ivHex) {
          throw new Error('Invalid backup file format.');
        }

        await EG_KEYSTORE.saveKey({
          keyId: data.keyId,
          label: data.label || 'Restored Key',
          fingerprint: data.fingerprint || '',
          publicKeyJwk: data.publicKeyJwk || {},
          saltHex: data.saltHex,
          ivHex: data.ivHex,
          ciphertextBase64: data.ciphertextBase64,
          iterations: data.iterations || 600000,
          createdAt: data.exportedAt || new Date().toISOString()
        });

        EG.utils.toast(`Key "${data.label}" restored to local browser storage!`, 'success');
        loadKeys();
      } catch (err) {
        EG.utils.toast('Restore failed: ' + err.message, 'error');
      } finally {
        restoreInput.value = '';
      }
    };
  }

  // Initial load
  loadKeys();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.getAttribute('data-page') === 'keys') {
    initKeysPage();
  }
});
