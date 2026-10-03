'use strict';

/**
 * scripts/lint-tenancy.js
 *
 * Scans all controllers and services to verify that no code directly executes
 * queries or mutations on raw tenant models without using the scoped data-access helper
 * (services/tenantScope) or the explicit unscoped() escape hatch.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const TARGET_DIRS = [
  path.join(ROOT_DIR, 'controllers'),
  path.join(ROOT_DIR, 'services')
];

// Exempt helper files that implement isolation or pure utility functions
const EXEMPT_FILES = new Set([
  path.normalize(path.join(ROOT_DIR, 'services', 'tenantScope.js')),
  path.normalize(path.join(ROOT_DIR, 'services', 'eventBus.js')),
  path.normalize(path.join(ROOT_DIR, 'services', 'hashService.js')),
  path.normalize(path.join(ROOT_DIR, 'services', 'tokenService.js')),
  path.normalize(path.join(ROOT_DIR, 'services', 'emailService.js'))
]);

const TENANT_MODELS = [
  'Evidence',
  'Block',
  'AuditLog',
  'Verification',
  'CustodyEvent',
  'Notification',
  'ForensicReport',
  'Anchor',
  'UserKey',
  'Counter',
  'User'
];

const MONGOOSE_METHODS = [
  'find',
  'findOne',
  'findById',
  'countDocuments',
  'estimatedDocumentCount',
  'distinct',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findByIdAndUpdate',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findByIdAndDelete',
  'aggregate',
  'create',
  'insertMany'
];

function getFilesRecursively(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath));
    } else if (fullPath.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function lintFile(filePath) {
  const normPath = path.normalize(filePath);
  if (EXEMPT_FILES.has(normPath)) return [];

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  // Check each line for direct raw model calls
  // Direct raw call regex: Model.method( without being wrapped by scoped( or unscoped(
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    for (const model of TENANT_MODELS) {
      for (const method of MONGOOSE_METHODS) {
        // Match Model.method(
        const pattern = new RegExp(`\\b${model}\\.${method}\\s*\\(`, 'g');
        if (pattern.test(line)) {
          // If the line or surrounding is unscoped(Model).method( or scoped(Model, ...).method(, it's allowed
          const isUnscopedWrapper = line.includes(`unscoped(${model})`) || line.includes(`unscoped(${model}.`);
          const isScopedWrapper = line.includes(`scoped(${model},`) || line.includes(`scoped(${model})`);
          
          if (!isUnscopedWrapper && !isScopedWrapper) {
            // Also check if model was defined via scoped(...) on a previous line in this file
            const scopedAssignPattern = new RegExp(`const\\s+${model}\\s*=\\s*scoped\\(`, 'g');
            const unscopedAssignPattern = new RegExp(`const\\s+${model}\\s*=\\s*unscoped\\(`, 'g');
            const hasScopedAssignment = scopedAssignPattern.test(content) || unscopedAssignPattern.test(content);

            if (!hasScopedAssignment) {
              violations.push({
                file: path.relative(ROOT_DIR, filePath),
                line: i + 1,
                content: trimmed,
                model,
                method
              });
            }
          }
        }
      }
    }
  }

  return violations;
}

function runLint() {
  console.log('======================================================================');
  console.log('              EvidenceGuard Tenancy Isolation Linter                  ');
  console.log('======================================================================');

  let allFiles = [];
  for (const dir of TARGET_DIRS) {
    allFiles = allFiles.concat(getFilesRecursively(dir));
  }

  const allViolations = [];
  for (const file of allFiles) {
    const fileViolations = lintFile(file);
    if (fileViolations.length > 0) {
      allViolations.push(...fileViolations);
    }
  }

  if (allViolations.length > 0) {
    console.error(`\n❌ Tenancy isolation violations detected (${allViolations.length} occurrences):\n`);
    for (const v of allViolations) {
      console.error(`  [FAIL] ${v.file}:${v.line} -> Direct call ${v.model}.${v.method}() without scoped helper`);
      console.error(`         Code: ${v.content}`);
    }
    console.error('\nControllers and services MUST access tenant models through scoped(Model, user) or explicit unscoped(Model) escape hatch.');
    return false;
  }

  console.log(`\n✅ Tenancy Lint Passed: Scanned ${allFiles.length} files across controllers/ and services/.`);
  console.log('   All data-access calls strictly use the scoped helper or explicit unscoped() hatch.\n');
  return true;
}

if (require.main === module) {
  const success = runLint();
  process.exit(success ? 0 : 1);
}

module.exports = { runLint, lintFile };
