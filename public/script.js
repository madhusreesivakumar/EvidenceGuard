'use strict';

/**
 * EvidenceGuard - Frontend Core Script
 * Sprint 8B - Error Handling, Accessibility, Responsive Navigation
 */

// Custom ApiError class
class ApiError extends Error {
  constructor(message, code = 'REQUEST_FAILED', status = 500, details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
window.ApiError = ApiError;

// Central apiFetch
async function apiFetch(method, endpoint, body = null, isFormData = false, customOptions = {}) {
  const isUpload = isFormData || customOptions.isUpload || (typeof FormData !== 'undefined' && body instanceof FormData);
  const timeoutMs = isUpload ? 120000 : 30000;

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {};
  if (!isUpload && body && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
  }

  const options = {
    method,
    headers,
    credentials: 'include',
    signal: controller.signal,
    ...customOptions
  };

  if (body) {
    options.body = (isUpload || typeof body === 'string') ? body : JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(endpoint, options);
  } catch (err) {
    clearTimeout(timeoutTimer);
    if (err.name === 'AbortError') {
      throw new ApiError('Request timed out. Please try again.', 'TIMEOUT', 408);
    }
    throw new ApiError('Cannot reach the server. Please check your connection.', 'NETWORK_ERROR', 0);
  }
  clearTimeout(timeoutTimer);

  // 401 handling: Redirect to login preserving ?next= (if not already on login/register/public)
  if (response.status === 401) {
    const publicPages = ['login.html', 'register.html', 'index.html', 'about.html'];
    const currentFile = location.pathname.split('/').pop() || 'index.html';
    const isAuthRoute = endpoint.includes('/api/auth/login') || endpoint.includes('/api/auth/register') || endpoint.includes('/api/auth/me');
    if (!isAuthRoute && !publicPages.includes(currentFile)) {
      const next = encodeURIComponent(currentFile + location.search);
      window.location.href = `login.html?next=${next}`;
    }
  }

  // 429 handling: Too many requests
  if (response.status === 429) {
    let msg = 'Too many requests, wait a moment';
    try {
      const j = await response.json();
      if (j && j.message) msg = j.message;
    } catch (_) {}
    throw new ApiError(msg, 'RATE_LIMITED', 429);
  }

  // Parse JSON or handle non-JSON responses
  const contentType = response.headers.get('content-type') || '';
  let json = null;
  if (contentType.includes('application/json')) {
    try {
      json = await response.json();
    } catch (_) {
      throw new ApiError('Invalid server response format.', 'INVALID_RESPONSE', response.status);
    }
  } else {
    const text = await response.text();
    if (!response.ok) {
      throw new ApiError(text || `Request failed with status ${response.status}`, 'HTTP_ERROR', response.status);
    }
    return text;
  }

  if (!response.ok) {
    const code = json.code || (response.status === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED');
    const msg = json.message || 'Request failed';
    throw new ApiError(msg, code, response.status, json.details);
  }

  return { ...json, ...(json.data && typeof json.data === 'object' ? json.data : {}) };
}

window.apiFetch = apiFetch;

const EG = {
  apiFetch,
  api: {
    _fetch: apiFetch,
    fetch: apiFetch,
    get: async (url, opts) => apiFetch('GET', url, null, false, opts),
    post: async (url, data, opts) => apiFetch('POST', url, data, false, opts),
    patch: async (url, data, opts) => apiFetch('PATCH', url, data, false, opts),
    del: async (url, data, opts) => apiFetch('DELETE', url, data, false, opts),
    upload: (url, formData, onProgress) => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const timeoutTimer = setTimeout(() => {
          xhr.abort();
          reject(new ApiError('Upload timed out after 120 seconds.', 'TIMEOUT', 408));
        }, 120000);

        let progressEl = document.getElementById('globalUploadProgress');
        if (!progressEl) {
          progressEl = document.createElement('div');
          progressEl.id = 'globalUploadProgress';
          progressEl.className = 'upload-progress-banner';
          progressEl.setAttribute('role', 'progressbar');
          progressEl.setAttribute('aria-valuemin', '0');
          progressEl.setAttribute('aria-valuemax', '100');
          progressEl.innerHTML = `<span class="progress-label">Uploading...</span> <div class="progress-bar-track"><div class="progress-bar-fill" style="width:0%"></div></div> <span class="progress-pct">0%</span>`;
          document.body.appendChild(progressEl);
        }
        progressEl.style.display = 'flex';

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            const fill = progressEl.querySelector('.progress-bar-fill');
            const pctText = progressEl.querySelector('.progress-pct');
            if (fill) fill.style.width = `${pct}%`;
            if (pctText) pctText.textContent = `${pct}%`;
            progressEl.setAttribute('aria-valuenow', String(pct));
            if (typeof onProgress === 'function') onProgress(pct, e.loaded, e.total);
          }
        };

        xhr.onload = () => {
          clearTimeout(timeoutTimer);
          progressEl.style.display = 'none';
          let json;
          try {
            json = JSON.parse(xhr.responseText);
          } catch (_) {
            return reject(new ApiError('Invalid server response format.', 'INVALID_RESPONSE', xhr.status));
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ ...json, ...(json.data && typeof json.data === 'object' ? json.data : {}) });
          } else {
            if (xhr.status === 401) {
              const currentFile = location.pathname.split('/').pop() || 'dashboard.html';
              const next = encodeURIComponent(currentFile + location.search);
              window.location.href = `login.html?next=${next}`;
            }
            const code = json.code || 'UPLOAD_FAILED';
            const msg = json.message || 'Upload failed';
            reject(new ApiError(msg, code, xhr.status, json.details));
          }
        };

        xhr.onerror = () => {
          clearTimeout(timeoutTimer);
          progressEl.style.display = 'none';
          reject(new ApiError('Cannot reach the server. Please check your connection.', 'NETWORK_ERROR', 0));
        };

        xhr.open('POST', url, true);
        xhr.withCredentials = true;
        xhr.send(formData);
      });
    }
  },
  utils: {
    escapeHtml: (str) => {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },
    formatErrorMessage: (err) => {
      if (!err) return 'An error occurred';
      if (typeof err === 'string') return err;
      if (err.message && typeof err.message === 'string') return err.message;
      if (err.code && typeof err.code === 'string') return `Error (${err.code})`;
      try {
        return JSON.stringify(err);
      } catch (_) {
        return 'An unexpected error occurred';
      }
    },
    sha256File: async (file) => {
      if (!file) return null;
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },
    formatDate: (d) => {
      if (!d) return 'N/A';
      const date = new Date(d);
      return date.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },
    formatBytes: (bytes) => {
      if (bytes === undefined || bytes === null) return 'N/A';
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },
    showToast: (typeOrMsg = 'success', maybeMsg) => {
      let type = 'success';
      let rawMsg = '';
      if (maybeMsg !== undefined) {
        if (['success', 'error', 'warning', 'info'].includes(typeOrMsg)) {
          type = typeOrMsg;
          rawMsg = maybeMsg;
        } else {
          rawMsg = typeOrMsg;
          type = maybeMsg;
        }
      } else {
        rawMsg = typeOrMsg;
      }

      const msg = EG.utils.formatErrorMessage(rawMsg);

      let container = document.querySelector('.toast-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'true');
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
      
      const borderColor = type === 'error' ? 'var(--status-tampered)' : type === 'warning' ? 'var(--status-pending)' : 'var(--status-verified)';
      toast.style.borderLeft = `4px solid ${borderColor}`;
      toast.textContent = msg;

      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    },
    toast: (msg, type = 'success') => EG.utils.showToast(type, msg),
    highlightNav: () => {
      const currentPath = location.pathname.split('/').pop() || 'index.html';
      document.querySelectorAll('.nav-item').forEach(link => {
        if (link.getAttribute('href') === currentPath) {
          link.classList.add('active');
          const title = link.textContent.replace(/[^\w\s]/g, '').trim();
          const pageTitle = document.getElementById('pageTitle');
          if (pageTitle) pageTitle.textContent = title;
        } else {
          link.classList.remove('active');
        }
      });
    }
  },
  ui: {
    renderLoading: (container, message = 'Loading data...') => {
      const el = typeof container === 'string' ? document.getElementById(container) : container;
      if (!el) return;
      el.innerHTML = `
        <div class="state-card state-loading" role="status" aria-live="polite">
          <div class="state-spinner" aria-hidden="true"></div>
          <p class="state-text">${EG.utils.escapeHtml(message)}</p>
        </div>`;
    },
    renderEmpty: (container, message = 'No records found.', actionHtml = '') => {
      const el = typeof container === 'string' ? document.getElementById(container) : container;
      if (!el) return;
      el.innerHTML = `
        <div class="state-card state-empty" role="status">
          <div class="state-icon" aria-hidden="true">📂</div>
          <p class="state-title">${EG.utils.escapeHtml(message)}</p>
          ${actionHtml ? `<div class="state-actions">${actionHtml}</div>` : ''}
        </div>`;
    },
    renderError: (container, errOrMsg, onRetry) => {
      const el = typeof container === 'string' ? document.getElementById(container) : container;
      if (!el) return;
      const msg = EG.utils.formatErrorMessage(errOrMsg);
      el.innerHTML = `
        <div class="state-card state-error" role="alert" aria-live="assertive">
          <div class="state-icon" aria-hidden="true">⚠️</div>
          <p class="state-title">An Error Occurred</p>
          <p class="state-desc">${EG.utils.escapeHtml(msg)}</p>
          ${onRetry ? `<button type="button" class="btn btn-secondary btn-retry">🔄 Retry</button>` : ''}
        </div>`;
      if (onRetry) {
        const retryBtn = el.querySelector('.btn-retry');
        if (retryBtn) retryBtn.addEventListener('click', onRetry);
      }
    }
  },
  auth: {
    currentUser: null,
    getCurrentUser: async () => {
      try {
        const res = await EG.api.get('/api/auth/me');
        if (res && res.success && res.user) {
          EG.auth.currentUser = res.user;
          return res.user;
        }
      } catch (err) {
        EG.auth.currentUser = null;
      }
      return null;
    },
    requireLogin: async () => {
      const user = await EG.auth.getCurrentUser();
      if (!user) {
        const currentFile = window.location.pathname.split('/').pop() || 'dashboard.html';
        const next = encodeURIComponent(currentFile + window.location.search);
        window.location.href = `login.html?next=${next}`;
      }
      return user;
    },
    logout: async () => {
      try {
        await EG.api.post('/api/auth/logout', {});
      } catch (e) {}
      EG.auth.currentUser = null;
      window.location.href = 'login.html';
    },
    applyRBAC: (user) => {
      if (!user) return;
      
      const role = user.role;
      const navUpload = document.querySelector('a[href="upload.html"]');
      const navAudit = document.querySelector('a[href="audit.html"]');
      const navUsers = document.querySelector('a[href="users.html"]');
      const navBlockchain = document.querySelector('a[href="blockchain.html"]');

      if (role === 'VIEWER') {
        if (navUpload) navUpload.style.display = 'none';
        if (navAudit) navAudit.style.display = 'none';
        if (navUsers) navUsers.style.display = 'none';
      } else if (role === 'INVESTIGATOR') {
        if (navUsers) navUsers.style.display = 'none';
      }

      const sidebarUserName = document.getElementById('sidebarUserName');
      const sidebarUserRole = document.getElementById('sidebarUserRole');
      const topbarRoleBadge = document.getElementById('topbarRoleBadge');
      if (sidebarUserName) sidebarUserName.textContent = user.name;
      if (sidebarUserRole) sidebarUserRole.textContent = user.role;
      if (topbarRoleBadge) {
        topbarRoleBadge.textContent = user.role;
        topbarRoleBadge.className = `badge badge-${role === 'ADMIN' ? 'tampered' : (role === 'INVESTIGATOR' ? 'pending' : 'verified')}`;
      }
    }
  }
};

window.EG = EG;
window.escapeHtml = EG.utils.escapeHtml;

// Setup double submit protection
function setupDoubleSubmitProtection() {
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submitBtn && !submitBtn.disabled) {
      submitBtn.disabled = true;
      submitBtn.dataset.originalText = submitBtn.innerHTML || submitBtn.value;
      submitBtn.classList.add('btn-loading');
      
      // Auto re-enable after 15s safety timeout
      setTimeout(() => {
        if (submitBtn.disabled && submitBtn.classList.contains('btn-loading')) {
          submitBtn.disabled = false;
          submitBtn.classList.remove('btn-loading');
          if (submitBtn.dataset.originalText) {
            if (submitBtn.tagName === 'INPUT') submitBtn.value = submitBtn.dataset.originalText;
            else submitBtn.innerHTML = submitBtn.dataset.originalText;
          }
        }
      }, 15000);
    }
  }, true);
}

// Setup global offline banner
function setupOfflineBanner() {
  let banner = document.getElementById('egOfflineBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'egOfflineBanner';
    banner.setAttribute('role', 'alert');
    banner.setAttribute('aria-live', 'assertive');
    banner.className = 'eg-offline-banner';
    document.body.prepend(banner);
  }

  function updateStatus() {
    if (!navigator.onLine) {
      banner.textContent = '⚠️ You are currently offline. Changes cannot be saved until connection is restored.';
      banner.className = 'eg-offline-banner is-offline';
      banner.style.display = 'block';
    } else if (banner.classList.contains('is-offline')) {
      banner.textContent = '✓ Back online! Connection restored.';
      banner.className = 'eg-offline-banner is-online';
      setTimeout(() => {
        banner.style.display = 'none';
        banner.classList.remove('is-online');
      }, 3000);
    } else {
      banner.style.display = 'none';
    }
  }

  window.addEventListener('offline', updateStatus);
  window.addEventListener('online', updateStatus);
  if (!navigator.onLine) updateStatus();
}

// Setup mobile sidebar with focus trap & Escape key
function setupMobileSidebar() {
  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  let backdrop = document.getElementById('sidebarBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebarBackdrop';
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
  }

  function openSidebar() {
    sidebar.classList.add('mobile-open');
    backdrop.classList.add('active');
    hamburger?.setAttribute('aria-expanded', 'true');
    const firstFocusable = sidebar.querySelector('a, button, input, [tabindex="0"]');
    if (firstFocusable) firstFocusable.focus();
  }

  function closeSidebar() {
    sidebar.classList.remove('mobile-open');
    backdrop.classList.remove('active');
    hamburger?.setAttribute('aria-expanded', 'false');
    hamburger?.focus();
  }

  if (hamburger) {
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-label', 'Toggle Navigation Menu');
    hamburger.addEventListener('click', () => {
      if (sidebar.classList.contains('mobile-open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });
  }

  backdrop.addEventListener('click', closeSidebar);

  sidebar.querySelectorAll('.sidebar-nav a, #logoutBtn').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 1024) closeSidebar();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (!sidebar.classList.contains('mobile-open')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeSidebar();
      return;
    }

    if (e.key === 'Tab') {
      const focusables = Array.from(sidebar.querySelectorAll('a, button, input, select, textarea, [tabindex="0"]'))
        .filter(el => !el.disabled && el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  });
}

// Common shell logic
document.addEventListener('DOMContentLoaded', () => {
  EG.utils.highlightNav();
  setupDoubleSubmitProtection();
  setupOfflineBanner();
  setupMobileSidebar();

  const publicPages = ['index.html', 'login.html', 'register.html', 'about.html', ''];
  const currentPath = location.pathname.split('/').pop() || 'index.html';
  const isPublicVerify = currentPath === 'verify.html' && new URLSearchParams(window.location.search).has('caseId');
  
  if (!publicPages.includes(currentPath) && !isPublicVerify) {
    EG.auth.requireLogin().then(user => {
      if (user) EG.auth.applyRBAC(user);
    });
  } else {
    EG.auth.getCurrentUser().then(user => {
      if (user) {
        EG.auth.applyRBAC(user);
        if (currentPath === 'login.html' || currentPath === 'register.html') {
          window.location.href = 'dashboard.html';
        }
      }
    });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      EG.auth.logout();
    });
  }

  const liveClock = document.getElementById('liveClock');
  if (liveClock) {
    setInterval(() => {
      liveClock.textContent = new Date().toLocaleString();
    }, 1000);
  }
});
