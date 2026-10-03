'use strict';

/**
 * config/permissions.js
 * Sprint 15A – Full Role & Permissions Matrix
 */

const PERMISSIONS = {
  // Platform administrator: manages organizations, cannot read evidence content
  SUPER_ADMIN: [
    'manageOrgs',
    'viewOrgs',
    'viewPlatformAudit'
  ],

  // Tenant administrator: full access within the tenant organization
  ORG_ADMIN: ['*'],

  // Backward compatibility alias for ORG_ADMIN
  ADMIN: ['*'],

  // Lead investigator: upload, inspect, verify, chain of custody, forensics view
  INVESTIGATOR: [
    'upload',
    'view',
    'verify',
    'download',
    'viewBlockchain',
    'viewAudit',
    'viewCustody',
    'custody',
    'viewForensics'
  ],

  // Laboratory analyst: view, verify, forensics extraction, custody events
  LAB_ANALYST: [
    'view',
    'verify',
    'download',
    'forensics',
    'viewForensics',
    'custody',
    'viewCustody'
  ],

  // Court officer: view and verify shared evidence, custody report
  COURT_OFFICER: [
    'view',
    'verify',
    'viewCustody',
    'custodyReport',
    'viewShared'
  ],

  // Independent auditor: audit logs, blockchain validation, reports; no file access
  AUDITOR: [
    'viewAudit',
    'validateAudit',
    'viewBlockchain',
    'validateBlockchain',
    'viewReports'
  ],

  // Viewer: read metadata and verify
  VIEWER: [
    'view',
    'verify'
  ]
};

/**
 * Determines whether a role has permission to execute an action.
 *
 * @param {string} role - User role
 * @param {string} action - Action requested
 * @returns {boolean}
 */
const can = (role, action) => {
  if (!role || typeof role !== 'string') return false;

  // Strict guard: SUPER_ADMIN cannot read evidence content or download files
  if (role === 'SUPER_ADMIN' && ['view', 'download', 'upload', 'verify', 'delete'].includes(action)) {
    return false;
  }

  // Strict guard: AUDITOR cannot download or access raw files
  if (role === 'AUDITOR' && ['download', 'upload', 'delete'].includes(action)) {
    return false;
  }

  const allowed = PERMISSIONS[role];
  if (!allowed) return false;
  if (allowed.includes('*')) return true;
  return allowed.includes(action);
};

module.exports = {
  PERMISSIONS,
  can
};
