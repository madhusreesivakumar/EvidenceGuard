const PERMISSIONS = {
  // '*' grants all actions
  ADMIN: ['*'],
  // manageUsers is ADMIN-only (not listed here so '*' check handles it)
  INVESTIGATOR: ['upload', 'view', 'verify', 'viewBlockchain', 'viewAudit'],
  VIEWER: ['view', 'verify']
};

const can = (role, action) => {
  const allowed = PERMISSIONS[role];
  if (!allowed) return false;
  if (allowed.includes('*')) return true;
  return allowed.includes(action);
};

module.exports = {
  PERMISSIONS,
  can
};
