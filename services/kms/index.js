'use strict';

/**
 * services/kms/index.js
 * Sprint 16A: KeyProvider Factory & Singleton Registry
 *
 * Selects and initializes the correct KeyProvider implementation based on
 * the KMS_PROVIDER environment variable. Production environments refuse to
 * boot with 'local' unless ALLOW_LOCAL_KMS=true is explicitly set.
 *
 * Supported providers:
 *   local   - Software AES-256-GCM key rings (dev/test only)
 *   pkcs11  - SoftHSM2 / HSM via PKCS#11 (free demo)
 *   aws     - AWS Key Management Service (production cloud)
 */

const LocalProvider  = require('./LocalProvider');
const Pkcs11Provider = require('./Pkcs11Provider');
const AwsKmsProvider = require('./AwsKmsProvider');

/** @type {import('./KeyProvider') | null} */
let _instance = null;

/**
 * Returns the singleton KeyProvider instance.
 * Safe to call many times; always returns the same instance per process.
 * @returns {import('./KeyProvider')}
 */
function getKeyProvider() {
  if (_instance) return _instance;

  const providerName = (process.env.KMS_PROVIDER || 'local').toLowerCase();
  const isProduction  = process.env.NODE_ENV === 'production';

  // Production safety gate — fail closed if local KMS is used without explicit opt-in
  if (isProduction && providerName === 'local' && process.env.ALLOW_LOCAL_KMS !== 'true') {
    const err = new Error(
      '[KMS] FATAL: KMS_PROVIDER=local is not allowed in production. ' +
      'Set KMS_PROVIDER=pkcs11 or KMS_PROVIDER=aws, or set ALLOW_LOCAL_KMS=true to override (INSECURE).'
    );
    err.code = 'KMS_INSECURE_CONFIG';
    throw err;
  }

  switch (providerName) {
    case 'pkcs11':
    case 'hsm':
      _instance = new Pkcs11Provider({
        tokenLabel:  process.env.SOFTHSM_TOKEN_LABEL || 'EvidenceGuardToken',
        slotId:      process.env.SOFTHSM_SLOT        || 0,
        libraryPath: process.env.SOFTHSM_LIB         || process.env.PKCS11_LIB || null,
        maxPoolSize: parseInt(process.env.KMS_POOL_SIZE || '10', 10),
        timeoutMs:   parseInt(process.env.KMS_TIMEOUT_MS || '5000', 10)
      });
      break;

    case 'aws':
    case 'awskms':
      _instance = new AwsKmsProvider({
        region:    process.env.AWS_REGION    || 'us-east-1',
        timeoutMs: parseInt(process.env.KMS_TIMEOUT_MS || '5000', 10)
      });
      break;

    case 'local':
    default:
      if (isProduction) {
        // Already guarded above, but double-check
        console.warn('[KMS] WARNING: Using local software KMS in production mode (ALLOW_LOCAL_KMS=true). NOT SECURE for production use.');
      }
      _instance = new LocalProvider({
        timeoutMs: parseInt(process.env.KMS_TIMEOUT_MS || '5000', 10)
      });
      break;
  }

  const providerType = _instance.constructor.name;
  console.log(`[KMS] Initialized KeyProvider: ${providerType} (KMS_PROVIDER=${providerName})`);
  return _instance;
}

/**
 * Resets the singleton — intended for test isolation only.
 * Never call this in production code.
 */
function _resetKeyProvider() {
  _instance = null;
}

/**
 * Performs a health check on the active KeyProvider.
 * Called at server startup to fail-fast on misconfiguration.
 * @returns {Promise<{ status: string, provider: string, latencyMs: number }>}
 */
async function healthCheck() {
  const provider = getKeyProvider();
  return provider.health();
}

module.exports = {
  getKeyProvider,
  healthCheck,
  _resetKeyProvider
};
