#!/usr/bin/env bash
# scripts/setup-softhsm.sh
# Sprint 16A: SoftHSM2 Token Initialization for the EvidenceGuard PKCS#11 Provider
#
# Usage:
#   chmod +x scripts/setup-softhsm.sh
#   ./scripts/setup-softhsm.sh [--token-label LABEL] [--pin PIN] [--so-pin SO_PIN]
#
# What this script does:
#   1. Verifies SoftHSM2 and pkcs11-tool are installed.
#   2. Creates (or re-initialises) a SoftHSM2 token labelled "EvidenceGuardToken".
#   3. Generates a non-extractable, CKA_SENSITIVE AES-256 key for STORAGE_KEK.
#   4. Generates a non-extractable, CKA_SENSITIVE ECDSA P-256 key pair for JWT_KEY.
#   5. Generates a non-extractable, CKA_SENSITIVE ECDSA P-256 key pair for NOTARY_KEY.
#   6. Prints the slot ID, token label and .env snippet to copy.
#
# Prerequisites (Linux / macOS):
#   Ubuntu/Debian:  sudo apt-get install softhsm2 opensc
#   Fedora/RHEL:    sudo dnf install softhsm opensc
#   macOS (Homebrew): brew install softhsm opensc
#
# Windows: Run inside WSL2 (Windows Subsystem for Linux) or
#          use the softhsm2-win pre-built installer from https://softhsm.opendnssec.org

set -euo pipefail

# ── Configurable defaults ─────────────────────────────────────────────────────
TOKEN_LABEL="${SOFTHSM_TOKEN_LABEL:-EvidenceGuardToken}"
USER_PIN="${SOFTHSM_PIN:-EvidGuard_HSM_Pin_2026!}"
SO_PIN="${SOFTHSM_SO_PIN:-EvidGuard_SO_Pin_2026!}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token-label) TOKEN_LABEL="$2"; shift 2 ;;
    --pin)         USER_PIN="$2";    shift 2 ;;
    --so-pin)      SO_PIN="$2";      shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Detect SoftHSM2 library path ──────────────────────────────────────────────
detect_softhsm_lib() {
  local candidates=(
    "/usr/lib/softhsm/libsofthsm2.so"
    "/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so"
    "/usr/local/lib/softhsm/libsofthsm2.so"
    "/opt/homebrew/lib/softhsm/libsofthsm2.so"
    "/usr/lib/aarch64-linux-gnu/softhsm/libsofthsm2.so"
  )
  for path in "${candidates[@]}"; do
    [[ -f "$path" ]] && echo "$path" && return
  done
  echo ""
}

# ── Preflight checks ──────────────────────────────────────────────────────────
echo "============================================================"
echo "  EvidenceGuard SoftHSM2 Token Setup (Sprint 16A)"
echo "============================================================"

if ! command -v softhsm2-util &> /dev/null; then
  echo "❌ ERROR: softhsm2-util not found."
  echo "   Install: sudo apt-get install softhsm2   (Ubuntu/Debian)"
  echo "            sudo dnf install softhsm         (Fedora/RHEL)"
  echo "            brew install softhsm             (macOS)"
  exit 1
fi

SOFTHSM_LIB=$(detect_softhsm_lib)
if [[ -z "$SOFTHSM_LIB" ]]; then
  echo "❌ ERROR: libsofthsm2.so not found at standard locations."
  echo "   Set SOFTHSM_LIB manually in your .env file."
  SOFTHSM_LIB="<path-to-libsofthsm2.so>"
fi
echo "✅ SoftHSM2 library: $SOFTHSM_LIB"

if ! command -v pkcs11-tool &> /dev/null; then
  echo "⚠️  WARNING: pkcs11-tool not found (opensc package)."
  echo "   Key generation will use softhsm2-util where possible."
  echo "   Install: sudo apt-get install opensc   (Ubuntu/Debian)"
  echo "            brew install opensc            (macOS)"
  HAS_PKCS11_TOOL=false
else
  HAS_PKCS11_TOOL=true
  echo "✅ pkcs11-tool: $(pkcs11-tool --version 2>/dev/null | head -1 || echo 'available')"
fi

# ── Initialize (or re-initialize) the token ───────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────"
echo "  Initializing token: $TOKEN_LABEL"
echo "──────────────────────────────────────────────────────────"

# Find existing slot for this label if any
EXISTING_SLOT=$(softhsm2-util --show-slots 2>/dev/null | grep -B5 "Label:.*${TOKEN_LABEL}" | grep "Slot" | head -1 | awk '{print $2}' || true)

if [[ -n "$EXISTING_SLOT" ]]; then
  echo "⚠️  Token '$TOKEN_LABEL' already exists in slot $EXISTING_SLOT."
  echo "   Re-using existing token. To re-initialize, delete:"
  echo "     softhsm2-util --delete-token --token '${TOKEN_LABEL}'"
else
  echo "   Creating new token '$TOKEN_LABEL'..."
  softhsm2-util --init-token --free \
    --label  "$TOKEN_LABEL" \
    --pin    "$USER_PIN"   \
    --so-pin "$SO_PIN"
  echo "✅ Token initialized."
fi

# Get the assigned slot
SLOT=$(softhsm2-util --show-slots 2>/dev/null | grep -B5 "Label:.*${TOKEN_LABEL}" | grep "^Slot" | head -1 | awk '{print $2}')
echo "   Slot ID: ${SLOT:-<check softhsm2-util --show-slots>}"

# ── Generate keys inside the HSM ─────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────"
echo "  Generating HSM key objects (CKA_SENSITIVE, non-extractable)"
echo "──────────────────────────────────────────────────────────"

if [[ "$HAS_PKCS11_TOOL" == "true" && -n "$SLOT" ]]; then

  # 1. STORAGE_KEK — AES-256 symmetric key
  echo ""
  echo "  [1/3] Generating STORAGE_KEK (AES-256)..."
  pkcs11-tool \
    --module      "$SOFTHSM_LIB" \
    --slot        "$SLOT" \
    --login --pin "$USER_PIN" \
    --keygen \
    --key-type    AES:32 \
    --label       "STORAGE_KEK_v1" \
    --id          "01" \
    --sensitive   --usage-decrypt --usage-encrypt \
    2>/dev/null && echo "  ✅ STORAGE_KEK_v1 generated" || echo "  ⚠️  STORAGE_KEK_v1 may already exist (skipped)"

  # 2. JWT_KEY — ECDSA P-256 key pair
  echo ""
  echo "  [2/3] Generating JWT_KEY (ECDSA P-256)..."
  pkcs11-tool \
    --module      "$SOFTHSM_LIB" \
    --slot        "$SLOT" \
    --login --pin "$USER_PIN" \
    --keypairgen \
    --key-type    EC:prime256v1 \
    --label       "JWT_KEY_v1" \
    --id          "02" \
    --sensitive \
    2>/dev/null && echo "  ✅ JWT_KEY_v1 generated" || echo "  ⚠️  JWT_KEY_v1 may already exist (skipped)"

  # 3. NOTARY_KEY — ECDSA P-256 key pair
  echo ""
  echo "  [3/3] Generating NOTARY_KEY (ECDSA P-256)..."
  pkcs11-tool \
    --module      "$SOFTHSM_LIB" \
    --slot        "$SLOT" \
    --login --pin "$USER_PIN" \
    --keypairgen \
    --key-type    EC:prime256v1 \
    --label       "NOTARY_KEY_v1" \
    --id          "03" \
    --sensitive \
    2>/dev/null && echo "  ✅ NOTARY_KEY_v1 generated" || echo "  ⚠️  NOTARY_KEY_v1 may already exist (skipped)"

else
  echo ""
  echo "  ⚠️  pkcs11-tool not available or slot not detected."
  echo "  Key objects will be generated at runtime by Pkcs11Provider"
  echo "  (in-memory simulation) when the application first starts."
fi

# ── List token contents ───────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────"
echo "  Token Contents"
echo "──────────────────────────────────────────────────────────"
if [[ "$HAS_PKCS11_TOOL" == "true" && -n "$SLOT" ]]; then
  pkcs11-tool \
    --module    "$SOFTHSM_LIB" \
    --slot      "$SLOT" \
    --login --pin "$USER_PIN" \
    --list-objects 2>/dev/null || echo "  (could not list objects)"
fi

# ── Print .env snippet ────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Add the following to your .env file:"
echo "============================================================"
cat <<ENV

# Sprint 16 – KMS / HSM Configuration
FEATURE_KMS=true
KMS_PROVIDER=pkcs11
STORAGE_USE_KMS=true
JWT_USE_KMS=false

# SoftHSM2 PKCS#11 settings
SOFTHSM_LIB=${SOFTHSM_LIB}
SOFTHSM_TOKEN_LABEL=${TOKEN_LABEL}
SOFTHSM_SLOT=${SLOT:-0}
SOFTHSM_PIN=<your-pin-here>
KMS_POOL_SIZE=10
KMS_TIMEOUT_MS=5000

ENV
echo "============================================================"
echo "  IMPORTANT: Do NOT put the actual PIN above in this script."
echo "  Set SOFTHSM_PIN via your secrets manager or a .env file"
echo "  that is gitignored (it already is in .gitignore)."
echo "============================================================"
echo ""
echo "✅ SoftHSM2 setup complete."
