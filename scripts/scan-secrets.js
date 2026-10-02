'use strict';
/**
 * scripts/scan-secrets.js
 * Sprint 8A – checks tracked files for accidental secret exposure.
 * Fails (exit 1) if any pattern matches.
 * Run: node scripts/scan-secrets.js
 */

const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');

const ROOT = path.join(__dirname, '..');

// Patterns to detect (regex source strings)
const SECRET_PATTERNS = [
  // MongoDB connection strings with credentials
  /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/i,
  // Long hex strings (32+ chars) that look like secrets – exempt package-lock.json
  // (checked selectively)
  // JWT_SECRET= followed by a literal secret value (not process.env)
  /(?:^|\s)JWT_SECRET\s*=\s*['"]?(?!process\.env)[a-zA-Z0-9_\-\.\+]{16,}['"]?/i,
  // Private key headers
  /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  // Generic password in assignment
  /password\s*=\s*['"][^'"]{8,}/i,
  // AWS key patterns
  /AKIA[0-9A-Z]{16}/,
  // .env file contents leaked
  /MONGODB_URI\s*=\s*mongodb/i
];

// Filename patterns that should never be tracked
const FORBIDDEN_FILES = [
  /^\.env$/,
  /^\.env\./,   // .env.local, .env.production, etc.
  /^uploads\//  // uploaded files directory
];

let errors = 0;

console.log('=== scan-secrets.js – Checking tracked files for secrets ===\n');

// 1. Check that .env and uploads/ are not tracked
let trackedFiles;
let isGit = false;
try {
  trackedFiles = execSync('git ls-files', { cwd: ROOT, stdio: ['pipe', 'pipe', 'ignore'] }).toString().split('\n').filter(Boolean);
  isGit = true;
} catch (e) {
  trackedFiles = [];
}

if (!isGit || trackedFiles.length === 0) {
  function walkDir(dir) {
    const list = [];
    for (const f of fs.readdirSync(dir)) {
      if (f === 'node_modules' || f === '.git' || f === 'scratch' || f === 'uploads' || f === '.env') continue;
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        list.push(...walkDir(full));
      } else {
        list.push(path.relative(ROOT, full).replace(/\\/g, '/'));
      }
    }
    return list;
  }
  trackedFiles = walkDir(ROOT);
}

if (isGit) {
  for (const f of trackedFiles) {
    if (FORBIDDEN_FILES.some(re => re.test(f))) {
      console.error(`[FAIL] Forbidden file is tracked by git: ${f}`);
      errors++;
    }
  }
}

// 2. Scan tracked source files for secret patterns
const SKIP_EXTENSIONS = new Set(['.lock', '.png', '.jpg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.svg', '.webp', '.mp4', '.mp3']);
const SKIP_FILES      = new Set(['package-lock.json', 'yarn.lock', 'scan-secrets.js']);

for (const rel of trackedFiles) {
  const ext  = path.extname(rel).toLowerCase();
  const base = path.basename(rel);
  if (SKIP_EXTENSIONS.has(ext) || SKIP_FILES.has(base)) continue;

  const abs = path.join(ROOT, rel);
  let content;
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch (_) {
    continue;
  }

  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        // Suppress false positives: .env.example placeholder comments
        if (base === '.env.example') continue;
        // Suppress test file fixtures (they use mock dummy secrets and passwords)
        if (base.startsWith('test-') && (
          /JWT_SECRET\s*=\s*['"][^'"]{32,}['"]/i.test(line) ||
          /password\s*=\s*['"][^'"]+['"]/i.test(line)
        )) continue;
        console.error(`[FAIL] Possible secret in ${rel}:${idx + 1}: ${line.trim().substring(0, 80)}`);
        errors++;
      }
    }
  });
}

if (errors === 0) {
  console.log('[PASS] No secrets or forbidden files detected.\n');
  process.exit(0);
} else {
  console.error(`\n[FAIL] ${errors} issue(s) found. Review and remove secrets before committing.\n`);
  process.exit(1);
}