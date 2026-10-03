'use strict';

Object.assign(window.EG, {
  // Legacy wrappers for auth
  auth: {
    ...window.EG.auth,
    getToken: () => null,
    getUser: () => window.EG.auth.currentUser,
    requireAuth: (redirectTo = 'login.html') => {
      window.EG.auth.requireLogin();
    },
    requireGuest: (redirectTo = 'dashboard.html') => {
      window.EG.auth.getCurrentUser().then(user => {
        if (user) window.location.href = redirectTo;
      });
    },
    isAdmin: () => window.EG.auth.currentUser?.role === 'ADMIN',
    isInvestigator: () => ['ADMIN', 'INVESTIGATOR'].includes(window.EG.auth.currentUser?.role),
    canUpload: () => ['ADMIN', 'INVESTIGATOR'].includes(window.EG.auth.currentUser?.role),
    canDelete: () => window.EG.auth.currentUser?.role === 'ADMIN',
    canViewAudit: () => ['ADMIN', 'INVESTIGATOR'].includes(window.EG.auth.currentUser?.role),
    canManageUsers: () => window.EG.auth.currentUser?.role === 'ADMIN'
  },
  // Utility helpers
  utils: {
    sha256File: async (file) => {
      if (!file) return null;
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return hashHex;
    },
    formatDate: (d) => {
      if (!d) return 'N/A';
      const date = new Date(d);
      return date.toLocaleString('en-US', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    },
    formatSize: (bytes) => {
      if (bytes === undefined || bytes === null) return 'N/A';
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },
    badgeHtml: (status) => {
      if (!status) return '';
      const s = status.toLowerCase();
      let color = 'gray';
      if (s === 'verified') color = 'green';
      if (s === 'pending') color = 'orange';
      if (s === 'tampered') color = 'red';
      return `<span class="badge" style="background-color: ${color}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px;">${status}</span>`;
    },
    roleBadgeHtml: (role) => {
      if (!role) return '';
      const r = role.toLowerCase();
      let color = '#3498db';
      if (r === 'admin') color = '#e74c3c';
      if (r === 'investigator') color = '#f39c12';
      return `<span class="badge" style="background-color: ${color}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px;">${role}</span>`;
    },
    toast: (msg, type = 'success') => {
      EG.utils.showToast(type, msg);
    },
    showSpinner: (text = 'Processing...') => {
      let overlay = document.querySelector('.spinner-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'spinner-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.8); z-index: 10000; display: flex; flex-direction: column; align-items: center; justify-content: center;';
        
        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        spinner.style.cssText = 'border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite;';
        
        const style = document.createElement('style');
        style.innerHTML = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
        document.head.appendChild(style);
        
        const textEl = document.createElement('div');
        textEl.className = 'spinner-text';
        textEl.style.cssText = 'margin-top: 15px; font-family: sans-serif; font-size: 16px; color: #333;';
        
        overlay.appendChild(spinner);
        overlay.appendChild(textEl);
        document.body.appendChild(overlay);
      }
      overlay.querySelector('.spinner-text').textContent = text;
      overlay.style.display = 'flex';
    },
    hideSpinner: () => {
      const overlay = document.querySelector('.spinner-overlay');
      if (overlay) {
        overlay.style.display = 'none';
      }
    },
    initSidebar: () => {
      const toggle = document.querySelector('.sidebar-toggle');
      const sidebar = document.querySelector('.sidebar');
      let overlay = document.querySelector('.sidebar-overlay');
      
      if (toggle && sidebar) {
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.className = 'sidebar-overlay';
          overlay.style.cssText = 'position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.5); z-index: 998; display: none;';
          document.body.appendChild(overlay);
        }
        
        toggle.addEventListener('click', () => {
          sidebar.classList.toggle('active');
          if (sidebar.classList.contains('active')) {
            overlay.style.display = 'block';
            sidebar.style.transform = 'translateX(0)';
          } else {
            overlay.style.display = 'none';
            sidebar.style.transform = '';
          }
        });
        
        overlay.addEventListener('click', () => {
          sidebar.classList.remove('active');
          sidebar.style.transform = '';
          overlay.style.display = 'none';
        });
      }
      
      // Active link
      const currentPath = location.pathname.split('/').pop() || 'index.html';
      document.querySelectorAll('.sidebar-nav a').forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPath) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      });
      
      // Logout handler
      document.querySelectorAll('.logout-btn, #logoutBtn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          try {
            await EG.api.post('/api/auth/logout');
          } catch(e) {} // ignore if it fails
          EG.auth.clearAuth();
          window.location.href = 'login.html';
        });
      });
    },
    renderPagination: (containerId, currentPage, totalPages, onPageChange) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.innerHTML = '';
      
      if (totalPages <= 1) return;
      
      const wrapper = document.createElement('div');
      wrapper.className = 'pagination';
      wrapper.style.cssText = 'display: flex; gap: 5px; justify-content: center; margin-top: 20px;';
      
      const createBtn = (text, page, disabled = false, active = false) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.disabled = disabled;
        btn.style.cssText = `padding: 6px 12px; border: 1px solid #ddd; background: ${active ? '#3498db' : 'white'}; color: ${active ? 'white' : '#333'}; cursor: ${disabled ? 'not-allowed' : 'pointer'}; border-radius: 4px;`;
        if (!disabled && !active) {
          btn.addEventListener('click', () => onPageChange(page));
        }
        return btn;
      };
      
      wrapper.appendChild(createBtn('Prev', currentPage - 1, currentPage === 1));
      
      let start = Math.max(1, currentPage - 2);
      let end = Math.min(totalPages, currentPage + 2);
      
      if (start > 1) {
        wrapper.appendChild(createBtn('1', 1));
        if (start > 2) {
          const dots = document.createElement('span');
          dots.textContent = '...';
          dots.style.padding = '6px';
          wrapper.appendChild(dots);
        }
      }
      
      for (let i = start; i <= end; i++) {
        wrapper.appendChild(createBtn(i.toString(), i, false, i === currentPage));
      }
      
      if (end < totalPages) {
        if (end < totalPages - 1) {
          const dots = document.createElement('span');
          dots.textContent = '...';
          dots.style.padding = '6px';
          wrapper.appendChild(dots);
        }
        wrapper.appendChild(createBtn(totalPages.toString(), totalPages));
      }
      
      wrapper.appendChild(createBtn('Next', currentPage + 1, currentPage === totalPages));
      container.appendChild(wrapper);
    },
    formatHash: (hash, short = true) => {
      if (!hash) return 'N/A';
      if (short && hash.length > 16) {
        return `${hash.substring(0, 8)}...${hash.substring(hash.length - 8)}`;
      }
      return hash;
    }
  }
});
window.EG = EG;

// ========================
// PAGE INITIALIZERS
// ========================

function initLogin() {
  EG.auth.requireGuest('dashboard.html');
  
  const form = document.getElementById('loginForm');
  if (!form) return;
  
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = 'color: #e74c3c; margin-top: 10px; font-size: 14px; text-align: center;';
  form.appendChild(errorDiv);
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorDiv.textContent = '';
    
    const email = form.email.value;
    const password = form.password.value;
    const submitBtn = form.querySelector('button[type="submit"]');
    
    if (submitBtn) submitBtn.disabled = true;
    
    try {
      const data = await EG.api.post('/api/auth/login', { email, password });
      if (data.success && data.token && data.user) {
        EG.auth.setAuth(data.token, data.user);
        window.location.href = 'dashboard.html';
      }
    } catch (err) {
      errorDiv.textContent = err.message || 'Login failed. Please check your credentials.';
      EG.utils.toast('Login failed', 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

function initRegister() {
  EG.auth.requireGuest('dashboard.html');
  
  const form = document.getElementById('registerForm');
  if (!form) return;
  
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = 'color: #e74c3c; margin-top: 10px; font-size: 14px; text-align: center;';
  form.appendChild(errorDiv);
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorDiv.textContent = '';
    
    const name = form.name.value;
    const email = form.email.value;
    const password = form.password.value;
    const confirmPassword = form.confirmPassword ? form.confirmPassword.value : form.querySelector('input[name="confirmPassword"]')?.value;
    
    if (password.length < 6) {
      errorDiv.textContent = 'Password must be at least 6 characters long.';
      return;
    }
    
    if (password !== confirmPassword) {
      errorDiv.textContent = 'Passwords do not match.';
      return;
    }
    
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    
    try {
      const data = await EG.api.post('/api/auth/register', { name, email, password });
      if (data.success && data.token && data.user) {
        EG.auth.setAuth(data.token, data.user);
        window.location.href = 'dashboard.html';
      }
    } catch (err) {
      errorDiv.textContent = err.message || 'Registration failed.';
      EG.utils.toast('Registration failed', 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

function initDashboard() {
  EG.auth.requireAuth('login.html');
  
  const user = EG.auth.getUser();
  const userNameEl = document.getElementById('sidebarUserName');
  const userRoleEl = document.getElementById('sidebarUserRole');
  const topbarRoleEl = document.getElementById('topbarRoleBadge');
  
  if (userNameEl && user) userNameEl.textContent = user.name || 'User';
  if (userRoleEl && user) userRoleEl.textContent = user.role || 'VIEWER';
  if (topbarRoleEl && user) {
    topbarRoleEl.textContent = user.role || 'VIEWER';
    if (user.role === 'ADMIN') topbarRoleEl.className = 'badge badge-tampered';
    else if (user.role === 'INVESTIGATOR') topbarRoleEl.className = 'badge badge-pending';
    else topbarRoleEl.className = 'badge badge-verified';
  }
  
  // Hide role-gated sidebar & quick action links
  if (!EG.auth.isAdmin()) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  }
  if (!EG.auth.canViewAudit()) {
    document.querySelectorAll('.audit-only').forEach(el => el.style.display = 'none');
  }
  if (!EG.auth.canUpload()) {
    document.querySelectorAll('.investigator-only').forEach(el => el.style.display = 'none');
  }
  if (!EG.auth.canManageUsers()) {
    document.querySelectorAll('.users-only').forEach(el => el.style.display = 'none');
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

  // Load and render all stats from GET /api/dashboard/stats
  const loadDashboardStats = async (isManual = false) => {
    const refreshBtn = document.getElementById('btnRefreshStats');
    const refreshText = document.getElementById('refreshBtnText');
    if (isManual && refreshText) {
      refreshText.textContent = 'Updating...';
      if (refreshBtn) refreshBtn.disabled = true;
    }

    try {
      const res = await EG.api.get('/api/dashboard/stats');
      if (!res.success || !res.data) {
        throw new Error(res.message || 'Failed to load stats');
      }
      const data = res.data;

      // 1. Evidence Stat Cards
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (typeof val === 'number') ? val.toLocaleString() : (val || '0');
      };
      setVal('stat-total', data.evidence.total);
      setVal('stat-verified', data.evidence.verified);
      setVal('stat-pending', data.evidence.pending);
      setVal('stat-tampered', data.evidence.tampered);
      setVal('stat-verifications', data.verificationStats.total);

      // Role-enforced stat cards
      const toggleCard = (cardId, valId, count) => {
        const card = document.getElementById(cardId);
        if (!card) return;
        if (count === null || count === undefined) {
          card.style.display = 'none';
        } else {
          card.style.display = 'flex';
          setVal(valId, count);
        }
      };
      toggleCard('card-users', 'stat-users', data.users);
      toggleCard('card-audit', 'stat-audit', data.auditEvents);
      toggleCard('card-blockchain', 'stat-blockchain', data.blocks);

      // 2. Blockchain Integrity Panel
      const bcPanel = document.getElementById('bcPanel');
      const bcHeading = document.getElementById('bcStatusHeading');
      const bcMeta = document.getElementById('bcStatusMeta');
      const btnValidateNow = document.getElementById('btnValidateNow');

      if (data.chain === null) {
        if (bcPanel) bcPanel.style.display = 'none';
      } else if (bcPanel) {
        bcPanel.style.display = 'flex';
        bcPanel.className = 'bc-panel';

        const lastVal = data.chain.lastValidation;
        if (!lastVal) {
          bcPanel.classList.add('bc-panel-unknown');
          if (bcHeading) bcHeading.textContent = 'Blockchain Integrity: NOT VALIDATED';
          if (bcMeta) bcMeta.innerHTML = '<span style="color:var(--status-pending);">No chain validation has been run yet.</span>';
        } else if (lastVal.valid === true) {
          bcPanel.classList.add('bc-panel-valid');
          if (bcHeading) bcHeading.textContent = 'Blockchain Integrity: VALID';
          
          const validDate = new Date(lastVal.validatedAt);
          const isStale = (Date.now() - validDate.getTime()) > (24 * 60 * 60 * 1000);
          let badgesHtml = '';
          if (isStale) {
            badgesHtml += '<span class="bc-badge-stale">Validation stale (&gt;24h)</span>';
          }
          if (data.chain.blocksSinceValidation > 0) {
            badgesHtml += `<span class="bc-badge-new">${data.chain.blocksSinceValidation} unvalidated new block(s)</span>`;
          }

          if (bcMeta) {
            bcMeta.innerHTML = `
              <span>Hash chain intact (${lastVal.blocksChecked || 0} blocks verified).</span>
              <span>Validated by <strong>${escapeHtml(lastVal.validatedByName || 'Admin')}</strong> on ${validDate.toLocaleString()}.</span>
              ${badgesHtml}
            `;
          }
        } else {
          bcPanel.classList.add('bc-panel-invalid');
          if (bcHeading) bcHeading.textContent = 'âš ï¸ Blockchain Integrity: INTEGRITY BREACH DETECTED';
          if (bcMeta) {
            bcMeta.innerHTML = `
              <span style="color:var(--status-tampered); font-weight:bold;">
                Hash mismatch at block #${lastVal.firstBrokenBlock !== null ? lastVal.firstBrokenBlock : 'unknown'}.
              </span>
              <span>Validated on ${new Date(lastVal.validatedAt).toLocaleString()}. Immediate audit required.</span>
            `;
          }
        }

        // Admin validate button
        if (btnValidateNow) {
          if (EG.auth.isAdmin()) {
            btnValidateNow.style.display = 'inline-flex';
            btnValidateNow.onclick = async () => {
              btnValidateNow.disabled = true;
              btnValidateNow.textContent = 'ðŸ›¡ Validating Chain...';
              try {
                const valRes = await EG.api.post('/api/blockchain/validate', {});
                if (valRes.success) {
                  EG.utils.toast(valRes.valid ? 'Blockchain is VALID!' : 'Blockchain is TAMPERED!', valRes.valid ? 'success' : 'error');
                  await loadDashboardStats();
                } else {
                  EG.utils.toast(valRes.message || 'Validation failed', 'error');
                }
              } catch (err) {
                EG.utils.toast(err.message || 'Validation failed', 'error');
              } finally {
                btnValidateNow.disabled = false;
                btnValidateNow.textContent = 'ðŸ›¡ Validate Ledger Now';
              }
            };
          } else {
            btnValidateNow.style.display = 'none';
          }
        }
      }

      // 3. 7-Day Verification Stats & Tamper Rate
      const tamperRateBadge = document.getElementById('tamperRateBadge');
      const chartBarsWrap = document.getElementById('chartBarsWrap');
      const totalVer = data.verificationStats.total || 0;
      const tamperedVer = data.verificationStats.tampered || 0;
      const tamperRate = totalVer > 0 ? ((tamperedVer / totalVer) * 100).toFixed(1) + '%' : '0.0%';
      if (tamperRateBadge) {
        tamperRateBadge.textContent = tamperRate;
        if (tamperedVer > 0) tamperRateBadge.style.color = 'var(--status-tampered)';
        else tamperRateBadge.style.color = 'var(--status-verified)';
      }

      if (chartBarsWrap && Array.isArray(data.verificationStats.last7Days)) {
        const days = data.verificationStats.last7Days;
        const maxVal = Math.max(1, ...days.map(d => Math.max(d.verified, d.tampered)));
        chartBarsWrap.innerHTML = '';
        days.forEach(day => {
          const vH = day.verified > 0 ? Math.max(4, Math.round((day.verified / maxVal) * 120)) : 2;
          const tH = day.tampered > 0 ? Math.max(4, Math.round((day.tampered / maxVal) * 120)) : 2;
          const shortDate = day.date.slice(5); // MM-DD
          
          const col = document.createElement('div');
          col.className = 'chart-col';
          col.title = `${day.date}: ${day.verified} verified, ${day.tampered} tampered`;
          col.innerHTML = `
            <div class="chart-bar-group">
              <div class="chart-bar chart-bar-verified" style="height: ${vH}px;"></div>
              <div class="chart-bar chart-bar-tampered" style="height: ${tH}px;"></div>
            </div>
            <div class="chart-col-label">${escapeHtml(shortDate)}</div>
          `;
          chartBarsWrap.appendChild(col);
        });
      }

      // 4. Recent Evidence Table
      const dashTbody = document.getElementById('dashTbody');
      if (dashTbody) {
        dashTbody.innerHTML = '';
        if (!data.recentEvidence || data.recentEvidence.length === 0) {
          dashTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:1.5rem;">No evidence registered yet</td></tr>';
        } else {
          data.recentEvidence.forEach(ev => {
            const tr = document.createElement('tr');
            const demoBadge = ev.isDemo ? `<span class="badge badge-demo" style="margin-left:6px; font-size:0.68rem; padding:2px 5px; background:rgba(0,212,255,0.15); color:var(--accent-cyan); border:1px solid var(--accent-cyan); border-radius:4px; vertical-align:middle; font-weight:700;">DEMO</span>` : '';
            tr.innerHTML = `
              <td data-label="ID"><span class="hash-pill">${escapeHtml(ev.evidenceId || 'N/A')}</span>${demoBadge}</td>
              <td data-label="Evidence Name" style="font-weight:600;">${escapeHtml(ev.name || 'Untitled')}</td>
              <td data-label="Type">${escapeHtml(ev.type || 'N/A')}</td>
              <td data-label="Status">${EG.utils.badgeHtml(ev.status)}</td>
              <td data-label="Date">${EG.utils.formatDate(ev.createdAt)}</td>
              <td data-label="Action">
                <a href="evidence-details.html?id=${encodeURIComponent(ev.evidenceId)}" class="btn-sm" style="background:var(--accent-blue); color:#fff; padding:3px 8px; border-radius:4px; text-decoration:none; font-size:0.8rem;">View</a>
              </td>
            `;
            dashTbody.appendChild(tr);
          });
        }
      }

      // 5. Recent Activity Feed
      const actCard = document.getElementById('recentActivityCard');
      const actList = document.getElementById('activityList');
      if (data.recentActivity === null) {
        if (actCard) actCard.style.display = 'none';
      } else if (actCard && actList) {
        actCard.style.display = 'block';
        actList.innerHTML = '';
        if (data.recentActivity.length === 0) {
          actList.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:1.5rem;">No recent audit activity</div>';
        } else {
          data.recentActivity.forEach(act => {
            const row = document.createElement('div');
            let actionClass = 'action-DEFAULT';
            if (act.action && act.action.includes('VERIF')) actionClass = 'action-VERIFY';
            else if (act.action && act.action.includes('TAMPER')) actionClass = 'action-TAMPER';
            else if (act.action && act.action.includes('DELETE')) actionClass = 'action-DELETE';
            else if (act.action && (act.action.includes('LOGIN') || act.action.includes('REGISTER'))) actionClass = 'action-AUTH';

            row.className = `activity-row ${actionClass}`;
            row.innerHTML = `
              <div style="flex:1;">
                <div class="activity-desc">${escapeHtml(act.description || act.action)}</div>
                <div class="activity-user">
                  by <strong>${escapeHtml(act.userName || 'System')}</strong> (${escapeHtml(act.role || 'N/A')})
                </div>
              </div>
              <div class="activity-time">${EG.utils.formatDate(act.timestamp)}</div>
            `;
            actList.appendChild(row);
          });
        }
      }

    } catch (err) {
      console.error('[DASHBOARD LOAD ERROR]', err);
      if (isManual) EG.utils.toast(err.message || 'Failed to refresh stats', 'error');
    } finally {
      if (refreshText) refreshText.textContent = 'Refresh';
      if (refreshBtn) refreshBtn.disabled = false;
    }
  };

  // Initial load
  loadDashboardStats();

  // Manual refresh button
  const refreshBtn = document.getElementById('btnRefreshStats');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadDashboardStats(true));
  }

  // 60-second Polling with visibility awareness
  let pollInterval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadDashboardStats();
    }
  }, 60000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadDashboardStats();
    }
  });

  // Live topbar and dash clock
  const updateClocks = () => {
    const nowStr = new Date().toLocaleString();
    const dashClock = document.getElementById('dashClock');
    const liveClock = document.getElementById('liveClock');
    if (dashClock) dashClock.textContent = nowStr;
    if (liveClock) liveClock.textContent = nowStr;
  };
  setInterval(updateClocks, 1000);
  updateClocks();
}

function initUpload() {
  EG.auth.requireAuth('login.html');
  
  if (!EG.auth.canUpload()) {
    EG.utils.toast('You do not have permission to upload evidence.', 'error');
    const form = document.getElementById('uploadForm');
    if (form) form.style.display = 'none';
    const errDiv = document.createElement('div');
    errDiv.textContent = 'Access Denied. You do not have permission to upload evidence.';
    errDiv.style.cssText = 'color: red; font-weight: bold; margin: 20px; text-align: center;';
    document.querySelector('main')?.prepend(errDiv);
    return;
  }
  
  let selectedFile = null;
  const fileDrop = document.getElementById('fileDrop');
  const fileInput = document.getElementById('fileInput');
  const fileChosen = document.getElementById('fileChosen');
  
  if (fileDrop && fileInput) {
    // Click to open dialog
    fileDrop.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        fileInput.click();
      }
    });
    
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        selectedFile = e.target.files[0];
        if (fileChosen) fileChosen.textContent = `Selected: ${selectedFile.name} (${EG.utils.formatSize(selectedFile.size)})`;
      }
    });
    
    // Drag and drop
    fileDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      fileDrop.style.borderColor = '#3498db';
      fileDrop.style.backgroundColor = '#f0f8ff';
    });
    
    fileDrop.addEventListener('dragleave', (e) => {
      e.preventDefault();
      fileDrop.style.borderColor = '#ccc';
      fileDrop.style.backgroundColor = 'transparent';
    });
    
    fileDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      fileDrop.style.borderColor = '#ccc';
      fileDrop.style.backgroundColor = 'transparent';
      
      if (e.dataTransfer.files.length > 0) {
        selectedFile = e.dataTransfer.files[0];
        fileInput.files = e.dataTransfer.files; // sync input
        if (fileChosen) fileChosen.textContent = `Selected: ${selectedFile.name} (${EG.utils.formatSize(selectedFile.size)})`;
      }
    });
  }
  
  const form = document.getElementById('uploadForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (!selectedFile) {
        EG.utils.toast('Please select a file to upload.', 'warning');
        return;
      }
      
      const formData = new FormData();
      formData.append('evidenceName', form.evidenceName?.value || '');
      formData.append('evidenceType', form.evidenceType?.value || '');
      formData.append('caseId', form.caseId?.value || '');
      formData.append('description', form.description?.value || '');
      formData.append('file', selectedFile);
      
      EG.utils.showSpinner('Encrypting and Uploading to Blockchain...');
      
      try {
        const data = await EG.api.upload('/api/evidence', formData);
        if (data.success && data.evidence) {
          EG.utils.toast('Evidence uploaded successfully');
          
          const resultPanel = document.getElementById('uploadResult');
          if (resultPanel) {
            resultPanel.className = 'upload-result-panel show success';
            resultPanel.style.display = 'block';
            
            const text = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
            text('resEvidenceId', data.evidence.evidenceId);
            text('resCaseId', data.evidence.caseId);
            text('resHash', data.evidence.hash);
            text('resDate', EG.utils.formatDate(data.evidence.createdAt));
            text('resBlockHash', data.blockHash || 'N/A');
            text('resFileName', data.evidence.fileName);
          }
          
          const guide = document.getElementById('uploadGuideCard');
          if (guide) guide.style.display = 'block';
          
          // Reset
          form.reset();
          selectedFile = null;
          if (fileChosen) fileChosen.textContent = '';
          // Wire reload button (replaces onclick attr removed for CSP compliance)
          const reloadBtn = document.getElementById('btnUploadAnother');
          if (reloadBtn) reloadBtn.onclick = () => location.reload();
        }
      } catch (err) {
        if (err.message && err.message.toLowerCase().includes('duplicate')) {
          EG.utils.toast('Duplicate evidence detected: ' + err.message, 'error');
        } else {
          EG.utils.toast('Upload failed: ' + err.message, 'error');
        }
      } finally {
        EG.utils.hideSpinner();
      }
    });
  }
}

function initRecords() {
  EG.auth.requireAuth('login.html');
  
  let currentPage = 1;
  const limit = 10;
  let currentSearch = '';
  let currentType = '';
  let currentStatus = '';
  
  const loadRecords = async () => {
    try {
      const tbody = document.getElementById('recordsTbody');
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">Loading...</td></tr>';
      
      const query = new URLSearchParams({
        page: currentPage,
        limit,
        search: currentSearch,
        type: currentType,
        status: currentStatus
      });
      
      const data = await EG.api.get(`/api/evidence?${query.toString()}`);
      if (data.success && tbody) {
        tbody.innerHTML = '';
        if (!data.evidence || data.evidence.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">No records found</td></tr>';
          EG.utils.renderPagination('recordsPagination', 1, 1, () => {});
          return;
        }
        
        data.evidence.forEach(ev => {
          const tr = document.createElement('tr');
          
          const hashCell = document.createElement('td');
          hashCell.className = 'hash-cell';
          hashCell.title = ev.hash;
          hashCell.textContent = EG.utils.formatHash(ev.hash);
          
          let actions = `
            <button onclick="location.href='evidence-details.html?id=${ev._id || ev.evidenceId}'" style="padding:4px 8px; cursor:pointer;">View</button>
            <button onclick="location.href='verify.html?evidenceId=${ev.evidenceId}'" style="padding:4px 8px; cursor:pointer; background:#f1c40f; border:none; border-radius:3px;">Verify</button>
          `;
          if (EG.auth.canDelete()) {
            actions += `<button class="del-btn" data-id="${ev._id || ev.evidenceId}" style="padding:4px 8px; cursor:pointer; background:#e74c3c; color:white; border:none; border-radius:3px; margin-left:4px;">Delete</button>`;
          }
          
          tr.innerHTML = `
            <td>${ev.evidenceId}</td>
            <td>${ev.caseId || 'N/A'}</td>
            <td>${ev.name || 'N/A'}</td>
            <td>${ev.type || 'N/A'}</td>
            <td>${EG.utils.badgeHtml(ev.status)}</td>
          `;
          
          tr.insertBefore(hashCell, null);
          const actionsTd = document.createElement('td');
          actionsTd.innerHTML = actions;
          tr.appendChild(actionsTd);
          
          tbody.appendChild(tr);
        });
        
        // Add delete listeners
        document.querySelectorAll('.del-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const id = e.target.getAttribute('data-id');
            if (confirm('Are you sure you want to delete this evidence? This action cannot be undone and will be logged in the audit trail.')) {
              try {
                EG.utils.showSpinner('Deleting...');
                await EG.api.del(`/api/evidence/${id}`);
                EG.utils.toast('Evidence deleted successfully');
                loadRecords();
              } catch (err) {
                EG.utils.toast('Failed to delete: ' + err.message, 'error');
              } finally {
                EG.utils.hideSpinner();
              }
            }
          });
        });
        
        EG.utils.renderPagination('recordsPagination', data.page, data.pages, (page) => {
          currentPage = page;
          loadRecords();
        });
      }
    } catch (err) {
      console.error(err);
      EG.utils.toast('Failed to load records', 'error');
    }
  };
  
  // Search
  let searchTimeout;
  const searchBox = document.getElementById('searchInput');
  if (searchBox) {
    searchBox.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        currentSearch = e.target.value;
        currentPage = 1;
        loadRecords();
      }, 400);
    });
  }
  
  // Filters
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentType = e.target.getAttribute('data-filter') === 'all' ? '' : e.target.getAttribute('data-filter');
      currentPage = 1;
      loadRecords();
    });
  });
  
  document.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentStatus = e.target.getAttribute('data-status') === 'all' ? '' : e.target.getAttribute('data-status');
      currentPage = 1;
      loadRecords();
    });
  });
  
  loadRecords();
}

function initEvidenceDetails() {
  EG.auth.requireAuth('login.html');
  
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  
  if (!id) {
    EG.utils.toast('No evidence ID provided', 'error');
    setTimeout(() => window.location.href = 'records.html', 2000);
    return;
  }
  
  let currentEvidenceId = null;
  
  const loadDetails = async () => {
    try {
      const data = await EG.api.get(`/api/evidence/${id}`);
      if (data.success && data.evidence) {
        const ev = data.evidence;
        currentEvidenceId = ev.evidenceId;
        
        const text = (elId, val) => { const el = document.getElementById(elId); if(el) el.textContent = val; };
        
        text('det-evidenceId', ev.evidenceId);
        text('det-caseId', ev.caseId || 'N/A');
        text('det-name', ev.name);
        text('det-type', ev.type);
        text('det-description', ev.description || 'No description provided.');
        text('det-fileName', ev.fileName);
        text('det-fileSize', EG.utils.formatSize(ev.fileSize));
        text('det-hash', ev.hash);
        text('det-createdAt', EG.utils.formatDate(ev.createdAt));
        text('det-verifiedAt', ev.verifiedAt ? EG.utils.formatDate(ev.verifiedAt) : 'Never');
        text('det-blockNumber', ev.blockNumber || 'Pending');
        
        const statusEl = document.getElementById('det-status');
        if (statusEl) statusEl.innerHTML = EG.utils.badgeHtml(ev.status);
        
        const uploaderEl = document.getElementById('det-uploadedBy');
        if (uploaderEl && ev.uploadedBy) {
          uploaderEl.textContent = `${ev.uploadedBy.name} (${ev.uploadedBy.email})`;
        }
        
        // Links and Buttons
        const verifyLink = document.getElementById('verifyLink');
        if (verifyLink) verifyLink.href = `verify.html?evidenceId=${ev.evidenceId}`;
        
        const deleteBtn = document.getElementById('deleteBtn');
        if (deleteBtn) {
          if (EG.auth.canDelete()) {
            deleteBtn.style.display = 'inline-block';
            deleteBtn.addEventListener('click', async () => {
              if (confirm('Delete this evidence record?')) {
                try {
                  await EG.api.del(`/api/evidence/${ev._id || ev.evidenceId}`);
                  EG.utils.toast('Deleted successfully');
                  window.location.href = 'records.html';
                } catch (err) {
                  EG.utils.toast('Failed to delete: ' + err.message, 'error');
                }
              }
            });
          } else {
            deleteBtn.style.display = 'none';
          }
        }
      }
    } catch (err) {
      EG.utils.toast('Failed to load evidence details', 'error');
      console.error(err);
    }
  };
  
  const qrBtn = document.getElementById('qrBtn');
  if (qrBtn) {
    qrBtn.addEventListener('click', async () => {
      try {
        const data = await EG.api.get(`/api/evidence/${id}/qr`);
        if (data.success && data.qrDataUrl) {
          const qrSection = document.getElementById('qrSection');
          const qrImage = document.getElementById('qrImage');
          const verifyUrlInput = document.getElementById('verifyUrlInput');
          if (qrSection && qrImage) {
            qrImage.src = data.qrDataUrl;
            if (verifyUrlInput && data.verifyUrl) {
                verifyUrlInput.value = data.verifyUrl;
            }
            qrSection.style.display = 'block';
          }
        }
      } catch (err) {
        EG.utils.toast('Failed to generate QR code', 'error');
      }
    });
  }
  
  loadDetails();
}

function initVerify() {
  // Elements
  const btnTypeEv = document.getElementById('btnTypeEv');
  const btnTypeCase = document.getElementById('btnTypeCase');
  const lookupId = document.getElementById('lookupId');
  const lookupBtn = document.getElementById('lookupBtn');
  const lookupError = document.getElementById('lookupError');
  const evidenceInfo = document.getElementById('evidenceInfo');

  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const vFileDrop = document.getElementById('vFileDrop');
  const vFileInput = document.getElementById('vFileInput');
  const vFileInfo = document.getElementById('vFileInfo');
  const vClientHash = document.getElementById('vClientHash');

  const step3 = document.getElementById('step3');
  const verifyBtn = document.getElementById('verifyBtn');
  const resetBtn = document.getElementById('resetBtn');
  const verifyError = document.getElementById('verifyError');

  const resultCard = document.getElementById('resultCard');
  const resultBadge = document.getElementById('resultBadge');
  const chainWarning = document.getElementById('chainWarning');
  const hashDiffBox = document.getElementById('hashDiffBox');
  const historyCard = document.getElementById('historyCard');

  const publicRecordCard = document.getElementById('publicRecordCard');
  const publicNotFoundCard = document.getElementById('publicNotFoundCard');
  const pubGuestPrompt = document.getElementById('pubGuestPrompt');
  const pubLoginBtn = document.getElementById('pubLoginBtn');

  let currentLookupType = 'ev'; // 'ev' or 'case'
  let currentEvidence = null;
  let selectedFile = null;
  let calculatedClientHash = '';
  let historyPage = 1;

  // Toggle ID Type
  const setLookupType = (type) => {
    currentLookupType = type;
    if (type === 'ev') {
      if (btnTypeEv) btnTypeEv.className = 'btn btn-primary';
      if (btnTypeCase) btnTypeCase.className = 'btn btn-outline';
      if (lookupId) lookupId.placeholder = 'EV-0000';
    } else {
      if (btnTypeEv) btnTypeEv.className = 'btn btn-outline';
      if (btnTypeCase) btnTypeCase.className = 'btn btn-primary';
      if (lookupId) lookupId.placeholder = 'EG-0000-0000';
    }
  };
  if (btnTypeEv) btnTypeEv.addEventListener('click', () => setLookupType('ev'));
  if (btnTypeCase) btnTypeCase.addEventListener('click', () => setLookupType('case'));

  // Prefill / Public routing
  const params = new URLSearchParams(window.location.search);
  const isCaseMode = params.has('caseId');
  const caseIdParam = params.get('caseId');

  if (isCaseMode) {
    // Public mode
    (async () => {
      try {
        const pubRes = await fetch(`/api/public/verify/${encodeURIComponent(caseIdParam)}`, {
          headers: { 'Accept': 'application/json' }
        });

        if (!pubRes.ok) {
          if (publicNotFoundCard) publicNotFoundCard.style.display = 'block';
          if (step1) step1.style.display = 'none';
          if (step2) step2.style.display = 'none';
          if (step3) step3.style.display = 'none';
          return;
        }

        const pubData = await pubRes.json();

        if (publicRecordCard) {
          publicRecordCard.style.display = 'block';
          const pubCaseId = document.getElementById('pubCaseId');
          const pubEvidenceId = document.getElementById('pubEvidenceId');
          const pubType = document.getElementById('pubType');
          const pubRegisteredAt = document.getElementById('pubRegisteredAt');
          const pubHash = document.getElementById('pubHash');
          const pubNote = document.getElementById('pubNote');
          const pubStatusBadge = document.getElementById('pubStatusBadge');
          const pubCopyHashBtn = document.getElementById('pubCopyHashBtn');

          if (pubCaseId) pubCaseId.textContent = pubData.caseId;
          if (pubEvidenceId) {
            pubEvidenceId.textContent = pubData.evidenceId;
            if (pubData.isDemo) {
              const demoBadge = document.createElement('span');
              demoBadge.className = 'badge badge-demo';
              demoBadge.textContent = 'DEMO';
              demoBadge.style.cssText = 'margin-left:8px; font-size:0.72rem; padding:2px 6px; background:rgba(0,212,255,0.15); color:var(--accent-cyan); border:1px solid var(--accent-cyan); border-radius:4px; vertical-align:middle; font-weight:700;';
              pubEvidenceId.appendChild(demoBadge);
            }
          }
          if (pubType) pubType.textContent = pubData.type;
          if (pubRegisteredAt) pubRegisteredAt.textContent = EG.utils.formatDate(pubData.registeredAt);
          if (pubHash) pubHash.textContent = pubData.hash;
          if (pubNote) pubNote.textContent = pubData.note;

          if (pubStatusBadge) {
            const s = (pubData.status || 'pending').toLowerCase();
            pubStatusBadge.innerHTML = `<span class="badge badge-${s}">${escapeHtml(pubData.status)}</span>`;
          }

          if (pubCopyHashBtn && pubData.hash) {
            pubCopyHashBtn.onclick = () => {
              navigator.clipboard.writeText(pubData.hash).then(() => {
                EG.utils.toast('SHA-256 hash copied', 'info');
              });
            };
          }
        }

        const user = await EG.auth.getCurrentUser();
        if (!user) {
          if (pubGuestPrompt) {
            pubGuestPrompt.style.display = 'block';
            if (pubLoginBtn) {
              const nextUrl = (window.location.pathname.split('/').pop() || 'verify.html') + window.location.search;
              pubLoginBtn.href = `login.html?next=${encodeURIComponent(nextUrl)}`;
            }
          }
          if (step1) step1.style.display = 'none';
          if (step2) step2.style.display = 'none';
          if (step3) step3.style.display = 'none';
        } else {
          setLookupType('case');
          if (lookupId) lookupId.value = caseIdParam;
          setTimeout(() => lookupBtn && lookupBtn.click(), 100);
        }
      } catch (err) {
        console.error('[Public Verify]', err);
        if (publicNotFoundCard) publicNotFoundCard.style.display = 'block';
        if (step1) step1.style.display = 'none';
        if (step2) step2.style.display = 'none';
        if (step3) step3.style.display = 'none';
      }
    })();
  } else {
    EG.auth.requireAuth('login.html');
    if (params.has('evidenceId')) {
      setLookupType('ev');
      if (lookupId) lookupId.value = params.get('evidenceId');
      setTimeout(() => lookupBtn && lookupBtn.click(), 100);
    }
  }

  // Lookup Evidence
  lookupBtn.addEventListener('click', async () => {
    lookupError.style.display = 'none';
    evidenceInfo.style.display = 'none';
    currentEvidence = null;
    disableSteps2And3();

    const val = lookupId.value.trim();
    if (!val) return;

    if (currentLookupType === 'ev' && !/^EV-\d{4}$/.test(val)) {
      lookupError.textContent = 'Invalid format. Use EV-0000';
      lookupError.style.display = 'block';
      return;
    }
    if (currentLookupType === 'case' && !/^EG-\d{4}-\d{4}$/.test(val)) {
      lookupError.textContent = 'Invalid format. Use EG-0000-0000';
      lookupError.style.display = 'block';
      return;
    }

    try {
      EG.utils.showSpinner('Looking up...');
      const qs = currentLookupType === 'ev' ? `?evidenceId=${encodeURIComponent(val)}` : `?caseId=${encodeURIComponent(val)}`;
      const res = await EG.api.get(`/api/evidence/lookup${qs}`);
      
      if (res.success) {
        currentEvidence = res.evidence;
        const nameEl = document.getElementById('infoName');
        if (nameEl) {
          nameEl.textContent = currentEvidence.name;
          if (currentEvidence.isDemo) {
            const demoBadge = document.createElement('span');
            demoBadge.className = 'badge badge-demo';
            demoBadge.textContent = 'DEMO';
            demoBadge.style.cssText = 'margin-left:8px; font-size:0.72rem; padding:2px 6px; background:rgba(0,212,255,0.15); color:var(--accent-cyan); border:1px solid var(--accent-cyan); border-radius:4px; vertical-align:middle; font-weight:700;';
            nameEl.appendChild(demoBadge);
          }
        }
        document.getElementById('infoType').textContent = currentEvidence.type;
        document.getElementById('infoFile').textContent = currentEvidence.fileName;
        document.getElementById('infoStatus').textContent = currentEvidence.status;
        evidenceInfo.style.display = 'block';
        enableStep2();
      }
    } catch (err) {
      lookupError.textContent = err.message || 'Evidence not found.';
      lookupError.style.display = 'block';
    } finally {
      EG.utils.hideSpinner();
    }
  });

  const disableSteps2And3 = () => {
    step2.style.opacity = '0.5'; step2.style.pointerEvents = 'none';
    step3.style.opacity = '0.5'; step3.style.pointerEvents = 'none';
    vFileInfo.style.display = 'none';
    selectedFile = null;
    vFileInput.value = '';
    resultCard.style.display = 'none';
    historyCard.style.display = 'none';
  };

  const enableStep2 = () => {
    step2.style.opacity = '1'; step2.style.pointerEvents = 'auto';
  };

  // Step 2: File upload
  vFileDrop.addEventListener('click', () => vFileInput.click());
  vFileDrop.addEventListener('dragover', e => { e.preventDefault(); vFileDrop.style.borderColor = '#64ffda'; });
  vFileDrop.addEventListener('dragleave', e => { e.preventDefault(); vFileDrop.style.borderColor = '#8892b0'; });
  vFileDrop.addEventListener('drop', e => {
    e.preventDefault();
    vFileDrop.style.borderColor = '#8892b0';
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  vFileInput.addEventListener('change', e => {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  const handleFile = async (file) => {
    selectedFile = file;
    document.getElementById('vFileName').textContent = file.name;
    document.getElementById('vFileSize').textContent = EG.utils.formatBytes(file.size);
    vFileInfo.style.display = 'block';
    
    // Hash
    vClientHash.textContent = 'Computing...';
    try {
      calculatedClientHash = await EG.utils.sha256File(file);
      vClientHash.textContent = calculatedClientHash;
      step3.style.opacity = '1'; step3.style.pointerEvents = 'auto';
    } catch (e) {
      vClientHash.textContent = 'Error computing hash';
    }
  };

  // Verify
  verifyBtn.addEventListener('click', async () => {
    if (!currentEvidence || !selectedFile) return;

    verifyError.style.display = 'none';
    resultCard.style.display = 'none';
    historyCard.style.display = 'none';
    verifyBtn.disabled = true;

    try {
      EG.utils.showSpinner('Verifying with Blockchain Ledger...');
      
      const fd = new FormData();
      fd.append('file', selectedFile);
      if (calculatedClientHash) fd.append('clientHash', calculatedClientHash);

      const res = await EG.api.upload(`/api/evidence/${encodeURIComponent(currentEvidence.evidenceId)}/verify`, fd);
      
      if (res.success) {
        showResult(res);
        verifyBtn.style.display = 'none';
        resetBtn.style.display = 'block';
      }
    } catch (err) {
      if (err.status === 422) {
        verifyError.textContent = 'The file was altered during upload. Please try again.';
      } else {
        verifyError.textContent = err.message || 'Verification failed due to a network or server error.';
      }
      verifyError.style.display = 'block';
    } finally {
      verifyBtn.disabled = false;
      EG.utils.hideSpinner();
    }
  });

  resetBtn.addEventListener('click', () => {
    selectedFile = null;
    vFileInput.value = '';
    vFileInfo.style.display = 'none';
    step3.style.opacity = '0.5'; step3.style.pointerEvents = 'none';
    verifyBtn.style.display = 'block';
    resetBtn.style.display = 'none';
    resultCard.style.display = 'none';
    historyCard.style.display = 'none';
  });

  window.copyHash = (id) => {
    const el = document.getElementById(id);
    if (el) {
      navigator.clipboard.writeText(el.textContent);
      EG.utils.toast('Copied!');
    }
  };

  const btnCopyOrig = document.getElementById('copyDetOrigHashBtn');
  if (btnCopyOrig) {
    btnCopyOrig.addEventListener('click', () => window.copyHash('detOrigHash'));
  }
  const btnCopyCurr = document.getElementById('copyDetCurrHashBtn');
  if (btnCopyCurr) {
    btnCopyCurr.addEventListener('click', () => window.copyHash('detCurrHash'));
  }

  const showResult = (res) => {
    resultCard.style.display = 'block';
    historyCard.style.display = 'block';
    
    resultBadge.className = 'badge-result ' + (res.result === 'VERIFIED' ? 'verified' : 'tampered');
    document.getElementById('rbIcon').textContent = res.result === 'VERIFIED' ? '✅' : '⚠️';
    document.getElementById('rbTitle').textContent = res.result;
    document.getElementById('rbDesc').textContent = res.result === 'VERIFIED' ? 
      'Evidence integrity confirmed.' : 'Evidence hash does not match the registered hash.';

    document.getElementById('detEvId').textContent = res.evidenceId;
    document.getElementById('detCaseId').textContent = res.caseId;
    document.getElementById('detResult').textContent = res.result;
    document.getElementById('detBy').textContent = res.verifiedBy;
    document.getElementById('detTime').textContent = new Date(res.verifiedAt).toLocaleString();
    document.getElementById('detOrigHash').textContent = res.originalHash;
    document.getElementById('detCurrHash').textContent = res.currentHash;

    // Chain Warning
    if (res.chainWarning) {
      chainWarning.style.display = 'block';
      document.getElementById('cwMsg').textContent = res.chainWarning;
    } else {
      chainWarning.style.display = 'none';
    }

    // Tampered highlight
    if (res.result === 'TAMPERED') {
      hashDiffBox.style.display = 'block';
      let origHtml = '';
      let currHtml = '';
      let diffCount = 0;
      
      for (let i = 0; i < 64; i++) {
        const o = res.originalHash[i] || '';
        const c = res.currentHash[i] || '';
        if (o !== c) {
          origHtml += `<span class="hash-char hash-diff">${o}</span>`;
          currHtml += `<span class="hash-char hash-diff">${c}</span>`;
          diffCount++;
        } else {
          origHtml += `<span class="hash-char">${o}</span>`;
          currHtml += `<span class="hash-char">${c}</span>`;
        }
      }
      document.getElementById('diffOriginal').innerHTML = origHtml;
      document.getElementById('diffCurrent').innerHTML = currHtml;
      document.getElementById('diffSummary').textContent = `${diffCount} of 64 characters differ`;
    } else {
      hashDiffBox.style.display = 'none';
    }

    historyPage = 1;
    loadHistory(res.evidenceId);
  };

  const loadHistory = async (evId) => {
    try {
      const tbody = document.getElementById('historyTbody');
      if (historyPage === 1) tbody.innerHTML = '';
      
      const res = await EG.api.get(`/api/evidence/${encodeURIComponent(evId)}/verifications?page=${historyPage}`);
      if (res.success && res.data) {
        res.data.forEach(v => {
          const tr = document.createElement('tr');
          const badge = v.result === 'VERIFIED' ? 
            '<span style="color:#2ecc71">✅ VERIFIED</span>' : '<span style="color:#e74c3c">⚠️ TAMPERED</span>';
          
          tr.innerHTML = `
            <td>${new Date(v.verifiedAt).toLocaleString()}</td>
            <td>${badge}</td>
            <td>${v.verifiedByName}</td>
            <td style="font-family:monospace" title="${v.submittedHash}">${EG.utils.formatHash(v.submittedHash)}</td>
          `;
          tbody.appendChild(tr);
        });

        const moreBtn = document.getElementById('historyMoreBtn');
        if (res.data.length === 50) { // max limit
          moreBtn.style.display = 'block';
          moreBtn.onclick = () => { historyPage++; loadHistory(evId); };
        } else {
          moreBtn.style.display = 'none';
        }
      }
    } catch(err) {
      console.error(err);
    }
  };
}

function initBlockchain() {
  EG.auth.requireAuth('login.html');
  
  let currentPage = 1;
  
  const loadBlocks = async () => {
    try {
      const data = await EG.api.get(`/api/blockchain?page=${currentPage}&limit=20`);
      if (data.success && data.blocks) {
        const container = document.getElementById('chainContainer');
        if (!container) return;
        container.innerHTML = '';
        
        data.blocks.forEach((block, index) => {
          const isGenesis = block.blockNumber === 0;
          
          const card = document.createElement('div');
          card.className = 'block-card';
          card.style.cssText = `border: 1px solid ${isGenesis ? '#f1c40f' : '#ccc'}; border-radius: 8px; padding: 15px; margin-bottom: 20px; background: ${isGenesis ? '#fcf3cf' : '#fff'}; box-shadow: 0 2px 4px rgba(0,0,0,0.1);`;
          
          card.innerHTML = `
            <div style="font-weight: bold; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 8px; color: ${isGenesis ? '#d4ac0d' : '#333'};">
              Block #${block.blockNumber} ${isGenesis ? '(Genesis Block)' : ''}
            </div>
            <div style="font-size: 13px; line-height: 1.5;">
              <div><strong>Timestamp:</strong> ${EG.utils.formatDate(block.timestamp)}</div>
              ${!isGenesis ? `
              <div><strong>Evidence ID:</strong> ${block.evidenceId}</div>
              <div><strong>Case ID:</strong> ${block.caseId || 'N/A'}</div>
              <div><strong>Evidence Hash:</strong> <span title="${block.evidenceHash}">${EG.utils.formatHash(block.evidenceHash)}</span></div>
              ` : '<div>Initialization block. No evidence attached.</div>'}
              <div style="margin-top:8px;"><strong>Prev Hash:</strong> <span style="font-family:monospace; background:#f5f5f5; padding:2px 4px;" title="${block.previousHash}">${EG.utils.formatHash(block.previousHash)}</span></div>
              <div><strong>Curr Hash:</strong> <span style="font-family:monospace; background:#f5f5f5; padding:2px 4px;" title="${block.currentHash}">${EG.utils.formatHash(block.currentHash)}</span></div>
            </div>
          `;
          
          container.appendChild(card);
          
          // Arrow
          if (index < data.blocks.length - 1) {
             const arrow = document.createElement('div');
             arrow.innerHTML = 'â¬‡ï¸';
             arrow.style.cssText = 'text-align: center; font-size: 24px; margin-bottom: 20px; color: #888;';
             container.appendChild(arrow);
          }
        });
        
        EG.utils.renderPagination('blockchainPagination', data.page, data.pages, (p) => {
          currentPage = p;
          loadBlocks();
        });
      }
    } catch (err) {
      EG.utils.toast('Failed to load blockchain', 'error');
    }
  };
  
  const validateBtn = document.getElementById('validateBtn');
  if (validateBtn) {
    validateBtn.addEventListener('click', async () => {
      EG.utils.showSpinner('Validating Ledger Integrity...');
      try {
        const data = await EG.api.post('/api/blockchain/validate');
        const resDiv = document.getElementById('validateResult');
        if (resDiv) {
          resDiv.style.display = 'block';
          resDiv.style.padding = '15px';
          resDiv.style.borderRadius = '5px';
          resDiv.style.marginTop = '20px';
          
          if (data.success && data.valid) {
            resDiv.style.backgroundColor = '#d4edda';
            resDiv.style.color = '#155724';
            resDiv.style.border = '1px solid #c3e6cb';
            resDiv.innerHTML = `<strong>âœ… Blockchain is Valid!</strong><br>Checked ${data.blocksChecked} blocks successfully. All hashes match.`;
          } else {
            resDiv.style.backgroundColor = '#f8d7da';
            resDiv.style.color = '#721c24';
            resDiv.style.border = '1px solid #f5c6cb';
            resDiv.innerHTML = `<strong>âŒ Blockchain is Invalid!</strong><br>${data.message}`;
          }
        }
      } catch (err) {
        EG.utils.toast('Validation request failed', 'error');
      } finally {
        EG.utils.hideSpinner();
      }
    });
  }
  
  loadBlocks();
}

function initAudit() {
  EG.auth.requireAuth('login.html');

  // Prevent default form submit (removed onsubmit attr for CSP compliance)
  const filterForm = document.getElementById('auditFilterForm');
  if (filterForm) filterForm.addEventListener('submit', e => e.preventDefault());
  if (!EG.auth.canViewAudit()) {
    window.location.href = 'dashboard.html';
    return;
  }
  
  let currentPage = 1;
  let currentAction = '';
  
  const loadAudit = async () => {
    try {
      const tbody = document.getElementById('auditTbody');
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">Loading...</td></tr>';
      
      let url = `/api/audit?page=${currentPage}&limit=20`;
      if (currentAction) url += `&action=${encodeURIComponent(currentAction)}`;
      
      const data = await EG.api.get(url);
      if (data.success && tbody) {
        tbody.innerHTML = '';
        if (!data.logs || data.logs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">No audit logs found</td></tr>';
          return;
        }
        
        data.logs.forEach(log => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${EG.utils.formatDate(log.timestamp)}</td>
            <td>${log.userName || log.userId}</td>
            <td>${EG.utils.roleBadgeHtml(log.role)}</td>
            <td><strong>${log.action}</strong></td>
            <td>${log.evidenceId || '-'}</td>
            <td>${log.description || '-'}</td>
            <td>${log.ipAddress || '-'}</td>
          `;
          tbody.appendChild(tr);
        });
        
        EG.utils.renderPagination('auditPagination', data.page, data.pages, (p) => {
          currentPage = p;
          loadAudit();
        });
      }
    } catch (err) {
      EG.utils.toast('Failed to load audit logs', 'error');
    }
  };
  
  const searchInput = document.getElementById('auditSearch');
  if (searchInput) {
    let timeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        currentAction = e.target.value;
        currentPage = 1;
        loadAudit();
      }, 400);
    });
  }
  
  loadAudit();
}

function initUsers() {
  EG.auth.requireAuth('login.html');
  if (!EG.auth.canManageUsers()) {
    EG.utils.toast('Access Denied: Only Admins can manage users.', 'error');
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 1500);
    return;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let currentPage = 1;
  const limit = 20;
  let debounceTimer = null;
  let pendingRoleChange = null;   // { userId, oldRole, newRole, selectEl }
  let pendingDeactivate = null;   // { userId, name }

  const me = EG.auth.getUser();

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const skeleton   = document.getElementById('usersSkeleton');
  const errorBox   = document.getElementById('usersError');
  const errorMsg   = document.getElementById('usersErrorMsg');
  const emptyBox   = document.getElementById('usersEmpty');
  const tableWrap  = document.getElementById('usersTableWrap');
  const tbody      = document.getElementById('usersTbody');
  const pagination = document.getElementById('usersPagination');
  const searchEl   = document.getElementById('usersSearch');
  const roleFilter = document.getElementById('usersRoleFilter');
  const statFilter = document.getElementById('usersStatusFilter');

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(d) {
    if (!d) return '<span style="color:var(--text-muted);">—</span>';
    return new Date(d).toLocaleString('en-US', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  function roleBadge(role) {
    const label = { ADMIN: 'Admin', INVESTIGATOR: 'Investigator', VIEWER: 'Viewer' }[role] || esc(role);
    return `<span class="badge-action badge-role-${esc(role)}">${label}</span>`;
  }

  function statusBadge(active) {
    return active
      ? `<span class="badge-action badge-status-active">Active</span>`
      : `<span class="badge-action badge-status-inactive">Inactive</span>`;
  }

  function setState(state) {
    skeleton.style.display  = state === 'loading' ? 'block' : 'none';
    errorBox.style.display  = state === 'error'   ? 'block' : 'none';
    emptyBox.style.display  = state === 'empty'   ? 'block' : 'none';
    tableWrap.style.display = state === 'table'   ? 'block' : 'none';
    pagination.style.display= state === 'table'   ? 'flex'  : 'none';
  }

  function buildPagination(total, page, lim) {
    pagination.innerHTML = '';
    const pages = Math.ceil(total / lim);
    if (pages <= 1) return;
    const prev = document.createElement('button');
    prev.className = 'page-btn';
    prev.textContent = '← Prev';
    prev.disabled = page <= 1;
    prev.onclick = () => { currentPage = page - 1; loadUsers(); };
    pagination.appendChild(prev);

    const info = document.createElement('span');
    info.style.cssText = 'font-size:0.82rem;color:var(--text-muted);padding:0 0.5rem;';
    info.textContent = `Page ${page} of ${pages} (${total} users)`;
    pagination.appendChild(info);

    const next = document.createElement('button');
    next.className = 'page-btn';
    next.textContent = 'Next →';
    next.disabled = page >= pages;
    next.onclick = () => { currentPage = page + 1; loadUsers(); };
    pagination.appendChild(next);
  }

  // ── Load Users ─────────────────────────────────────────────────────────────
  async function loadUsers() {
    setState('loading');
    try {
      const qs = new URLSearchParams();
      const q  = (searchEl.value || '').trim();
      if (q) qs.set('q', q);
      if (roleFilter.value) qs.set('role', roleFilter.value);
      qs.set('status', statFilter.value || 'active');
      qs.set('page', currentPage);
      qs.set('limit', limit);
      qs.set('sortBy', 'createdAt');
      qs.set('sortOrder', 'desc');

      const data = await EG.api.get('/api/users?' + qs.toString());
      if (!data.success) throw new Error(data.message || 'Failed to load users');

      if (!data.users || data.users.length === 0) { setState('empty'); return; }

      tbody.innerHTML = '';
      data.users.forEach(u => {
        const isSelf    = me && (u._id === me._id || u.email === me.email);
        const isInactive = !u.isActive;
        const tr = document.createElement('tr');
        if (isInactive) tr.classList.add('user-row-inactive');

        // Role select (inline, disabled for self or inactive)
        let roleCell;
        if (isInactive) {
          roleCell = roleBadge(u.role);
        } else if (isSelf) {
          roleCell = `<span data-tooltip="You cannot change your own account">${roleBadge(u.role)}</span>
            <select class="role-select-inline" disabled data-tooltip="You cannot change your own account">
              <option value="ADMIN" ${u.role==='ADMIN'?'selected':''}>Admin</option>
              <option value="INVESTIGATOR" ${u.role==='INVESTIGATOR'?'selected':''}>Investigator</option>
              <option value="VIEWER" ${u.role==='VIEWER'?'selected':''}>Viewer</option>
            </select>`;
        } else {
          roleCell = `<select class="role-select-inline" data-id="${esc(u._id)}" data-name="${esc(u.name)}" data-current="${esc(u.role)}">
              <option value="ADMIN" ${u.role==='ADMIN'?'selected':''}>Admin</option>
              <option value="INVESTIGATOR" ${u.role==='INVESTIGATOR'?'selected':''}>Investigator</option>
              <option value="VIEWER" ${u.role==='VIEWER'?'selected':''}>Viewer</option>
            </select>`;
        }

        // Actions
        let actionsCell;
        if (isInactive) {
          actionsCell = '<span style="color:var(--text-muted);font-size:0.8rem;">—</span>';
        } else if (isSelf) {
          actionsCell = `<span style="color:var(--text-muted);font-size:0.8rem;" data-tooltip="You cannot change your own account">
            <button class="btn btn-secondary" style="font-size:0.75rem;padding:3px 8px;" disabled data-tooltip="You cannot change your own account">Deactivate</button>
          </span>`;
        } else {
          actionsCell = `<button class="btn btn-danger btn-deactivate"
              style="font-size:0.75rem;padding:3px 8px;"
              data-id="${esc(u._id)}" data-name="${esc(u.name)}">Deactivate</button>`;
        }

        tr.innerHTML = `
          <td style="font-weight:500;">${esc(u.name)}</td>
          <td style="font-size:0.85rem;color:var(--text-muted);">${esc(u.email)}</td>
          <td>${roleCell}</td>
          <td>${statusBadge(u.isActive)}</td>
          <td style="font-size:0.8rem;">${fmtDate(u.createdAt)}</td>
          <td style="font-size:0.8rem;">${fmtDate(u.lastLoginAt)}</td>
          <td style="text-align:center;">${actionsCell}</td>
        `;
        tbody.appendChild(tr);
      });

      // Bind role change selects
      tbody.querySelectorAll('.role-select-inline:not([disabled])').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const newRole = e.target.value;
          const oldRole = e.target.dataset.current;
          const name    = e.target.dataset.name;
          const userId  = e.target.dataset.id;
          if (newRole === oldRole) return;

          pendingRoleChange = { userId, oldRole, newRole, selectEl: e.target };
          document.getElementById('changeRoleMsg').textContent =
            `Change ${name}'s role from ${oldRole} to ${newRole}?`;
          document.getElementById('errChangeRole').textContent = '';
          openModal('modalChangeRole');
        });
      });

      // Bind deactivate buttons
      tbody.querySelectorAll('.btn-deactivate').forEach(btn => {
        btn.addEventListener('click', () => {
          pendingDeactivate = { userId: btn.dataset.id, name: btn.dataset.name };
          document.getElementById('deactivateMsg').textContent =
            `Deactivate ${btn.dataset.name}?`;
          document.getElementById('errDeactivate').textContent = '';
          openModal('modalDeactivate');
        });
      });

      setState('table');
      buildPagination(data.total, data.page, data.limit);
    } catch (err) {
      console.error('[initUsers] loadUsers error', err);
      errorMsg.textContent = err.message || 'Failed to load users.';
      setState('error');
    }
  }

  // ── Modal helpers ──────────────────────────────────────────────────────────
  function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.style.display = 'flex';
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.style.display = 'none';
  }

  // ── Filters ────────────────────────────────────────────────────────────────
  searchEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { currentPage = 1; loadUsers(); }, 300);
  });
  roleFilter.addEventListener('change', () => { currentPage = 1; loadUsers(); });
  statFilter.addEventListener('change', () => { currentPage = 1; loadUsers(); });

  document.getElementById('btnUsersRetry').addEventListener('click', loadUsers);

  // ── Add User Modal ─────────────────────────────────────────────────────────
  document.getElementById('btnAddUser').addEventListener('click', () => {
    document.getElementById('addUserForm').reset();
    ['errAuName','errAuEmail','errAuPassword','errAuConfirm','errAuGlobal'].forEach(id => {
      document.getElementById(id).textContent = '';
    });
    openModal('modalAddUser');
  });
  ['btnCloseAddUser','btnCancelAddUser'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => closeModal('modalAddUser'));
  });

  // Show/hide password toggle
  document.getElementById('btnToggleAuPwd').addEventListener('click', () => {
    const inp = document.getElementById('auPassword');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('addUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let valid = true;

    const name     = document.getElementById('auName').value.trim();
    const email    = document.getElementById('auEmail').value.trim();
    const password = document.getElementById('auPassword').value;
    const confirm  = document.getElementById('auConfirm').value;
    const role     = document.getElementById('auRole').value;

    // Clear
    ['errAuName','errAuEmail','errAuPassword','errAuConfirm','errAuGlobal'].forEach(id => {
      document.getElementById(id).textContent = '';
    });

    if (!name || name.length < 2) {
      document.getElementById('errAuName').textContent = 'Name must be at least 2 characters.';
      valid = false;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('errAuEmail').textContent = 'Valid email address required.';
      valid = false;
    }
    if (!password || password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      document.getElementById('errAuPassword').textContent = 'Min 8 chars, at least one letter and one number.';
      valid = false;
    }
    if (password !== confirm) {
      document.getElementById('errAuConfirm').textContent = 'Passwords do not match.';
      valid = false;
    }
    if (!valid) return;

    const btn = document.getElementById('btnSubmitAddUser');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      await EG.api.post('/api/users', { name, email, password, role });
      closeModal('modalAddUser');
      EG.utils.toast(`User ${email} created successfully.`, 'success');
      currentPage = 1;
      loadUsers();
    } catch (err) {
      const msg = err.message || 'Failed to create user.';
      document.getElementById('errAuGlobal').textContent =
        msg.includes('409') || msg.toLowerCase().includes('already') ? 'Email is already registered.' : msg;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create User';
    }
  });

  // ── Change Role Modal ──────────────────────────────────────────────────────
  ['btnCloseChangeRole','btnCancelChangeRole'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      // Reset the dropdown to previous value
      if (pendingRoleChange && pendingRoleChange.selectEl) {
        pendingRoleChange.selectEl.value = pendingRoleChange.oldRole;
      }
      pendingRoleChange = null;
      closeModal('modalChangeRole');
    });
  });

  document.getElementById('btnConfirmChangeRole').addEventListener('click', async () => {
    if (!pendingRoleChange) return;
    const btn = document.getElementById('btnConfirmChangeRole');
    btn.disabled = true;
    btn.textContent = 'Changing…';
    document.getElementById('errChangeRole').textContent = '';
    const { userId, oldRole, newRole, selectEl } = pendingRoleChange;
    try {
      await EG.api.patch(`/api/users/${userId}/role`, { role: newRole });
      closeModal('modalChangeRole');
      pendingRoleChange = null;
      EG.utils.toast('Role updated successfully.', 'success');
      loadUsers();
    } catch (err) {
      // Reset select to previous
      if (selectEl) selectEl.value = oldRole;
      document.getElementById('errChangeRole').textContent = err.message || 'Failed to change role.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirm Change';
    }
  });

  // ── Deactivate Modal ───────────────────────────────────────────────────────
  ['btnCloseDeactivate','btnCancelDeactivate'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      pendingDeactivate = null;
      closeModal('modalDeactivate');
    });
  });

  document.getElementById('btnConfirmDeactivate').addEventListener('click', async () => {
    if (!pendingDeactivate) return;
    const btn = document.getElementById('btnConfirmDeactivate');
    btn.disabled = true;
    btn.textContent = 'Deactivating…';
    document.getElementById('errDeactivate').textContent = '';
    const { userId, name } = pendingDeactivate;
    try {
      await EG.api.del(`/api/users/${userId}`);
      closeModal('modalDeactivate');
      pendingDeactivate = null;
      EG.utils.toast(`${name} has been deactivated.`, 'success');
      loadUsers();
    } catch (err) {
      document.getElementById('errDeactivate').textContent = err.message || 'Failed to deactivate user.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Deactivate';
    }
  });

  // Close modals on overlay click
  ['modalAddUser','modalChangeRole','modalDeactivate'].forEach(id => {
    const m = document.getElementById(id);
    if (m) m.addEventListener('click', (e) => {
      if (e.target === m) {
        if (id === 'modalChangeRole' && pendingRoleChange) {
          pendingRoleChange.selectEl.value = pendingRoleChange.oldRole;
          pendingRoleChange = null;
        }
        closeModal(id);
      }
    });
  });

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ['modalAddUser','modalChangeRole','modalDeactivate'].forEach(id => closeModal(id));
      if (pendingRoleChange) {
        pendingRoleChange.selectEl.value = pendingRoleChange.oldRole;
        pendingRoleChange = null;
      }
    }
  });

  // ── Clock ──────────────────────────────────────────────────────────────────
  const updateClock = () => {
    const nowStr = new Date().toLocaleString();
    const dc = document.getElementById('dashClock');
    const lc = document.getElementById('liveClock');
    if (dc) dc.textContent = nowStr;
    if (lc) lc.textContent = nowStr;
  };
  setInterval(updateClock, 1000);
  updateClock();

  // ── Initial load ───────────────────────────────────────────────────────────
  loadUsers();
}
function initBlockchain() {
  EG.auth.requireAuth('login.html');
  const user = EG.auth.getUser();
  if (!user || user.role === 'VIEWER') {
    window.location.href = 'dashboard.html';
    return;
  }

  const validateBtn = document.getElementById('validateBtn');
  if (user.role === 'ADMIN' && validateBtn) {
    validateBtn.style.display = 'block';
  }

  const chainContainer = document.getElementById('chainContainer');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const banner = document.getElementById('validationBanner');
  
  let currentPage = 1;
  const limit = 20;

  const renderBlocks = (blocks, append = false) => {
    if (!append) chainContainer.innerHTML = '';
    
    if (blocks.length === 1 && blocks[0].blockNumber === 0) {
      chainContainer.innerHTML = `<div style="text-align:center; margin-top:30px;">
        <p>Genesis Block only. No evidence uploaded yet.</p>
        <a href="upload.html" class="btn btn-primary">Upload Evidence</a>
      </div>`;
    }

    blocks.forEach((block, index) => {
      if (index > 0 || append) {
        chainContainer.innerHTML += `<div class="chain-link" id="link-${block.blockNumber}"></div>`;
      }

      const isGenesis = block.blockNumber === 0;
      const deletedBadge = block.evidenceDeleted ? `<span class="badge badge-tampered" style="font-size:0.75rem; padding:2px 8px; margin-left:8px;">evidence deleted</span>` : '';
      let evidenceLink = isGenesis ? 'N/A' : (block.evidenceDeleted ? `<span style="color:#8892b0">${escapeHtml(block.evidenceId)}</span> ${deletedBadge}` : `<a href="evidence-details.html?id=${encodeURIComponent(block.evidenceId)}" style="color:#64ffda">${escapeHtml(block.evidenceId)}</a>`);
      
      const html = `
        <div class="block-card" id="block-${block.blockNumber}">
          <h3 style="margin-top:0; display:flex; align-items:center; justify-content:space-between;">
            <span>${isGenesis ? 'GENESIS BLOCK' : `Block #${block.blockNumber}`}</span>
            ${block.evidenceDeleted ? `<span class="badge badge-tampered" style="font-size:0.75rem;">evidence deleted</span>` : ''}
          </h3>
          
          <div style="display:grid; grid-template-columns: 100px 1fr; gap: 10px; margin-bottom: 10px; font-size:0.9rem;">
            <span style="color:#8892b0">Timestamp:</span> <span>${new Date(block.timestamp).toLocaleString()}</span>
            <span style="color:#8892b0">Evidence:</span> <span>${evidenceLink}</span>
            ${!isGenesis ? `<span style="color:#8892b0">Case ID:</span> <span>${escapeHtml(block.caseId)}</span>` : ''}
          </div>

          <div style="margin-bottom: 8px;">
            <div style="color:#8892b0; font-size:0.8rem; margin-bottom:2px;">Previous Hash:</div>
            <div class="hash-display" style="border-left: 2px solid #ff007f;">
              <span class="hash-expandable collapsed" title="${block.previousHash}">${EG.utils.formatHash(block.previousHash)}</span>
              <button class="btn-copy" onclick="navigator.clipboard.writeText('${block.previousHash}')">Copy</button>
            </div>
          </div>

          ${!isGenesis ? `
          <div style="margin-bottom: 8px;">
            <div style="color:#8892b0; font-size:0.8rem; margin-bottom:2px;">Evidence Hash:</div>
            <div class="hash-display">
              <span class="hash-expandable collapsed" title="${block.evidenceHash}">${EG.utils.formatHash(block.evidenceHash)}</span>
              <button class="btn-copy" onclick="navigator.clipboard.writeText('${block.evidenceHash}')">Copy</button>
            </div>
          </div>` : ''}

          <div>
            <div style="color:#8892b0; font-size:0.8rem; margin-bottom:2px;">Current Hash:</div>
            <div class="hash-display" style="border-left: 2px solid #00f2fe;">
              <span class="hash-expandable collapsed" title="${block.currentHash}">${EG.utils.formatHash(block.currentHash)}</span>
              <button class="btn-copy" onclick="navigator.clipboard.writeText('${block.currentHash}')">Copy</button>
            </div>
          </div>
          
          <div id="error-${block.blockNumber}" style="display:none; color:var(--status-tampered); margin-top:10px; font-size:0.9rem;"></div>
        </div>
      `;
      chainContainer.innerHTML += html;
    });
  };

  const loadChain = async (append = false) => {
    try {
      const res = await EG.api.get(`/api/blockchain?page=${currentPage}&limit=${limit}&order=asc`);
      if (res.success) {
        renderBlocks(res.data, append);
        
        if (!append) {
           const bTotal = document.getElementById('bcTotal');
           if (bTotal) bTotal.innerText = res.meta.total;
           if(res.meta.head) {
             const headNum = document.getElementById('bcHeadNum');
             if (headNum) headNum.innerText = res.meta.head.blockNumber;
             const headHash = document.getElementById('bcHeadHash');
             if (headHash) headHash.innerText = EG.utils.formatHash(res.meta.head.hash);
           }
        }

        if (currentPage * limit < res.meta.total) {
          if (loadMoreBtn) loadMoreBtn.style.display = 'inline-block';
        } else {
          if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        }
      }
    } catch(err) {
      console.error(err);
    }
  };

  loadChain();

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      currentPage++;
      loadChain(true);
    });
  }

  if (validateBtn) {
    validateBtn.addEventListener('click', async () => {
      validateBtn.disabled = true;
      validateBtn.innerText = 'Validating...';
      banner.className = 'validation-banner';
      banner.style.display = 'none';
      
      document.querySelectorAll('.block-card').forEach(c => {
        c.classList.remove('invalid', 'downstream');
        const errDiv = c.querySelector('[id^="error-"]');
        if (errDiv) errDiv.style.display = 'none';
      });

      try {
        const res = await EG.api.post('/api/blockchain/validate');
        
        banner.style.display = 'block';
        if (res.valid) {
          banner.className = 'validation-banner valid';
          banner.innerHTML = `<strong>${res.message}</strong><br>Checked ${res.blocksChecked} blocks at ${new Date(res.validatedAt).toLocaleTimeString()}`;
        } else {
          banner.className = 'validation-banner invalid';
          let issuesHtml = res.issues.map(i => `<li>Block ${i.blockNumber}: ${i.check} failed. Expected ${i.expected}, got ${i.actual}</li>`).join('');
          banner.innerHTML = `<strong>${res.message}</strong><br>Checked ${res.blocksChecked} blocks.<br><ul>${issuesHtml}</ul>`;

          if (res.firstBrokenBlock !== null) {
            const brokenCard = document.getElementById(`block-${res.firstBrokenBlock}`);
            if (brokenCard) {
              brokenCard.classList.add('invalid');
              const errDiv = document.getElementById(`error-${res.firstBrokenBlock}`);
              if (errDiv) {
                errDiv.style.display = 'block';
                errDiv.innerText = 'INTEGRITY BREAK DETECTED HERE';
              }
            }
            
            const allCards = document.querySelectorAll('.block-card');
            let mark = false;
            allCards.forEach(c => {
              const bNum = parseInt(c.id.replace('block-', ''));
              if (mark) c.classList.add('downstream');
              if (bNum === res.firstBrokenBlock) mark = true;
            });
          }
        }
      } catch(err) {
        EG.utils.toast('Validation failed: ' + (err.message || 'Error occurred'), 'error');
      } finally {
        validateBtn.disabled = false;
        validateBtn.innerText = 'ðŸ” Validate Blockchain';
      }
    });
  }
}

function initRecords() {
  EG.auth.requireAuth('login.html');
  const user = EG.auth.getUser();

  const topUploadBtn = document.getElementById('topUploadBtn');
  if (topUploadBtn && user && ['ADMIN', 'INVESTIGATOR'].includes(user.role)) {
    topUploadBtn.style.display = 'inline-block';
  }

  const searchInput = document.getElementById('recordSearch');
  const filterType = document.getElementById('filterType');
  const filterStatus = document.getElementById('filterStatus');
  const filterDateFrom = document.getElementById('filterDateFrom');
  const filterDateTo = document.getElementById('filterDateTo');
  const filterSort = document.getElementById('filterSort');
  const clearFiltersBtn = document.getElementById('clearFiltersBtn');
  const emptyClearBtn = document.getElementById('emptyClearBtn');

  const recordsTbody = document.getElementById('recordsTbody');
  const recordsCount = document.getElementById('recordsCount');
  const emptyState = document.getElementById('emptyState');
  const errorState = document.getElementById('errorState');
  const errorMessage = document.getElementById('errorMessage');
  const retryBtn = document.getElementById('retryBtn');
  const paginationContainer = document.getElementById('paginationContainer');
  const paginationInfo = document.getElementById('paginationInfo');
  const paginationControls = document.getElementById('paginationControls');

  // Modal elements
  const deleteModal = document.getElementById('deleteModal');
  const deleteEvidenceDisplay = document.getElementById('deleteEvidenceDisplay');
  const deleteReasonInput = document.getElementById('deleteReasonInput');
  const deleteReasonError = document.getElementById('deleteReasonError');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

  let pendingDeleteId = null;
  let searchTimeout = null;
  let currentTotalPages = 1;

  const readStateFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    return {
      q: params.get('q') || '',
      type: params.get('type') || '',
      status: params.get('status') || '',
      dateFrom: params.get('dateFrom') || '',
      dateTo: params.get('dateTo') || '',
      sortBy: params.get('sortBy') || 'createdAt',
      sortOrder: params.get('sortOrder') || 'desc',
      page: parseInt(params.get('page')) || 1
    };
  };

  const syncControlsWithState = (state) => {
    if (searchInput) searchInput.value = state.q;
    if (filterType) filterType.value = state.type;
    if (filterStatus) filterStatus.value = state.status;
    if (filterDateFrom) filterDateFrom.value = state.dateFrom;
    if (filterDateTo) filterDateTo.value = state.dateTo;
    if (filterSort) filterSort.value = `${state.sortBy}:${state.sortOrder}`;
  };

  const updateUrlWithState = (state, replace = false) => {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.type) params.set('type', state.type);
    if (state.status) params.set('status', state.status);
    if (state.dateFrom) params.set('dateFrom', state.dateFrom);
    if (state.dateTo) params.set('dateTo', state.dateTo);
    if (state.sortBy && state.sortBy !== 'createdAt') params.set('sortBy', state.sortBy);
    if (state.sortOrder && state.sortOrder !== 'desc') params.set('sortOrder', state.sortOrder);
    if (state.page && state.page > 1) params.set('page', state.page);

    const queryString = params.toString();
    const newUrl = window.location.pathname + (queryString ? '?' + queryString : '');
    if (replace) {
      window.history.replaceState({}, '', newUrl);
    } else {
      window.history.pushState({}, '', newUrl);
    }
  };

  const showSkeleton = () => {
    if (!recordsTbody) return;
    recordsTbody.innerHTML = Array(5).fill(0).map(() => `
      <tr>
        <td><div class="skeleton" style="width: 80px;"></div></td>
        <td><div class="skeleton" style="width: 100px;"></div></td>
        <td><div class="skeleton" style="width: 140px;"></div></td>
        <td><div class="skeleton" style="width: 60px;"></div></td>
        <td><div class="skeleton" style="width: 110px;"></div></td>
        <td><div class="skeleton" style="width: 130px;"></div></td>
        <td><div class="skeleton" style="width: 90px;"></div></td>
        <td><div class="skeleton" style="width: 85px;"></div></td>
        <td><div class="skeleton" style="width: 70px;"></div></td>
        <td><div class="skeleton" style="width: 120px;"></div></td>
      </tr>
    `).join('');
    if (emptyState) emptyState.style.display = 'none';
    if (errorState) errorState.style.display = 'none';
    if (recordsCount) recordsCount.textContent = 'Loading records...';
  };

  const fetchRecords = async () => {
    showSkeleton();

    const state = readStateFromUrl();
    const [sortField, sortDirection] = (filterSort?.value || 'createdAt:desc').split(':');
    state.sortBy = sortField || 'createdAt';
    state.sortOrder = sortDirection || 'desc';

    const queryParams = new URLSearchParams({
      page: state.page,
      limit: 20,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder
    });

    if (state.q) queryParams.set('q', state.q);
    if (state.type) queryParams.set('type', state.type);
    if (state.status) queryParams.set('status', state.status);
    if (state.dateFrom) queryParams.set('dateFrom', state.dateFrom);
    if (state.dateTo) queryParams.set('dateTo', state.dateTo);

    try {
      const res = await EG.api.get(`/api/evidence?${queryParams.toString()}`);
      
      const items = res.items || [];
      const total = res.total || 0;
      const page = res.page || 1;
      const limit = res.limit || 20;
      currentTotalPages = res.totalPages || Math.ceil(total / limit) || 1;

      if (items.length === 0) {
        recordsTbody.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        if (paginationContainer) paginationContainer.style.display = 'none';
        if (recordsCount) recordsCount.textContent = '0 records found';
        return;
      }

      if (emptyState) emptyState.style.display = 'none';
      if (errorState) errorState.style.display = 'none';

      const start = (page - 1) * limit + 1;
      const end = Math.min(page * limit, total);
      if (recordsCount) recordsCount.textContent = `Showing ${start}â€“${end} of ${total} records`;

      const isAdmin = user && user.role === 'ADMIN';

      recordsTbody.innerHTML = items.map(item => {
        const evId = escapeHtml(item.evidenceId);
        const cId = escapeHtml(item.caseId);
        const evName = escapeHtml(item.name || 'Untitled');
        const evType = escapeHtml(item.type || 'Other');
        const fName = escapeHtml(item.fileName || 'N/A');
        const uploader = escapeHtml(item.uploadedByName || 'Unknown');
        const dateStr = EG.utils.formatDate(item.createdAt);
        const statusBadge = `<span class="badge badge-${(item.status || 'pending').toLowerCase()}">${escapeHtml(item.status || 'Pending')}</span>`;
        const demoBadge = item.isDemo ? `<span class="badge badge-demo" style="margin-left: 6px; font-size: 0.68rem; padding: 2px 5px; background: rgba(0, 212, 255, 0.15); color: var(--accent-cyan); border: 1px solid var(--accent-cyan); border-radius: 4px; vertical-align: middle; font-weight: 700; letter-spacing: 0.5px;">DEMO</span>` : '';
        
        const fullHash = item.hash || '';
        const shortHash = fullHash ? `${fullHash.slice(0, 10)}...${fullHash.slice(-6)}` : 'N/A';
        const hashHtml = fullHash ? `
          <span class="hash-pill" title="${escapeHtml(fullHash)}">
            <span>${escapeHtml(shortHash)}</span>
            <button type="button" class="btn-copy-sm copy-hash-btn" data-hash="${escapeHtml(fullHash)}">Copy</button>
          </span>
        ` : 'N/A';

        const viewUrl = `evidence-details.html?id=${encodeURIComponent(item.evidenceId)}`;
        const verifyUrl = `verify.html?evidenceId=${encodeURIComponent(item.evidenceId)}`;

        const deleteBtnHtml = isAdmin ? `
          <button type="button" class="btn btn-danger btn-delete-row" data-id="${evId}" data-name="${evName}" style="padding: 4px 8px; font-size: 0.78rem; min-height: auto;">Delete</button>
        ` : '';

        return `
          <tr id="row-${evId}">
            <td data-label="Evidence ID">
              <a href="${viewUrl}" style="font-weight: 600; color: var(--accent-cyan);">${evId}</a>${demoBadge}
            </td>
            <td data-label="Case ID">${cId}</td>
            <td data-label="Evidence Name" style="font-weight: 500;">${evName}</td>
            <td data-label="Type">${evType}</td>
            <td data-label="File Name" style="color: var(--text-muted); word-break: break-all;">${fName}</td>
            <td data-label="SHA-256">${hashHtml}</td>
            <td data-label="Uploaded By">${uploader}</td>
            <td data-label="Date" style="white-space: nowrap; font-size: 0.85rem; color: var(--text-muted);">${dateStr}</td>
            <td data-label="Status">${statusBadge}</td>
            <td data-label="Actions" style="text-align: right; white-space: nowrap;">
              <a href="${viewUrl}" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.78rem; min-height: auto; margin-right: 4px;">View</a>
              <a href="${verifyUrl}" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.78rem; min-height: auto; margin-right: 4px;">Verify</a>
              ${deleteBtnHtml}
            </td>
          </tr>
        `;
      }).join('');

      // Wire copy hash buttons
      document.querySelectorAll('.copy-hash-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const h = btn.getAttribute('data-hash');
          if (h && navigator.clipboard) {
            navigator.clipboard.writeText(h).then(() => {
              EG.utils.toast('SHA-256 hash copied to clipboard', 'info');
            });
          }
        });
      });

      // Wire delete buttons
      document.querySelectorAll('.btn-delete-row').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetId = btn.getAttribute('data-id');
          const targetName = btn.getAttribute('data-name');
          openDeleteModal(targetId, targetName);
        });
      });

      renderPagination(page, currentTotalPages, total, start, end);

    } catch (err) {
      console.error('[Records]', err);
      if (recordsTbody) recordsTbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'none';
      if (errorState) errorState.style.display = 'block';
      if (errorMessage) errorMessage.textContent = err.message || 'Failed to communicate with records API';
      if (paginationContainer) paginationContainer.style.display = 'none';
      if (recordsCount) recordsCount.textContent = 'Error';
    }
  };

  const renderPagination = (page, totalPages, total, start, end) => {
    if (!paginationContainer || !paginationControls || !paginationInfo) return;

    if (totalPages <= 1) {
      paginationContainer.style.display = 'none';
      return;
    }

    paginationContainer.style.display = 'flex';
    paginationInfo.textContent = `Page ${page} of ${totalPages} (${total} total records)`;

    let html = '';
    html += `<button type="button" class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>&laquo; Prev</button>`;

    // Build page numbers
    let startPage = Math.max(1, page - 2);
    let endPage = Math.min(totalPages, page + 2);

    if (startPage > 1) {
      html += `<button type="button" class="page-btn" data-page="1">1</button>`;
      if (startPage > 2) html += `<span style="padding: 0 4px; color: var(--text-muted); align-self: center;">...</span>`;
    }

    for (let p = startPage; p <= endPage; p++) {
      html += `<button type="button" class="page-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) html += `<span style="padding: 0 4px; color: var(--text-muted); align-self: center;">...</span>`;
      html += `<button type="button" class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    html += `<button type="button" class="page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next &raquo;</button>`;

    paginationControls.innerHTML = html;

    paginationControls.querySelectorAll('.page-btn').forEach(b => {
      b.addEventListener('click', () => {
        const targetPage = parseInt(b.getAttribute('data-page'));
        if (targetPage && targetPage !== page && targetPage >= 1 && targetPage <= totalPages) {
          const state = readStateFromUrl();
          state.page = targetPage;
          updateUrlWithState(state);
          fetchRecords();
        }
      });
    });
  };

  // Search input debounced
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const state = readStateFromUrl();
        state.q = searchInput.value.trim();
        state.page = 1;
        updateUrlWithState(state);
        fetchRecords();
      }, 300);
    });
  }

  // Filter change listeners
  const onFilterChange = () => {
    const state = readStateFromUrl();
    if (filterType) state.type = filterType.value;
    if (filterStatus) state.status = filterStatus.value;
    if (filterDateFrom) state.dateFrom = filterDateFrom.value;
    if (filterDateTo) state.dateTo = filterDateTo.value;

    if (filterSort) {
      const [f, d] = filterSort.value.split(':');
      state.sortBy = f;
      state.sortOrder = d;
    }

    state.page = 1;
    updateUrlWithState(state);
    fetchRecords();
  };

  if (filterType) filterType.addEventListener('change', onFilterChange);
  if (filterStatus) filterStatus.addEventListener('change', onFilterChange);
  if (filterDateFrom) filterDateFrom.addEventListener('change', onFilterChange);
  if (filterDateTo) filterDateTo.addEventListener('change', onFilterChange);
  if (filterSort) filterSort.addEventListener('change', onFilterChange);

  // Clear filters
  const clearFilters = () => {
    if (searchInput) searchInput.value = '';
    if (filterType) filterType.value = '';
    if (filterStatus) filterStatus.value = '';
    if (filterDateFrom) filterDateFrom.value = '';
    if (filterDateTo) filterDateTo.value = '';
    if (filterSort) filterSort.value = 'createdAt:desc';

    const state = {
      q: '',
      type: '',
      status: '',
      dateFrom: '',
      dateTo: '',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      page: 1
    };
    updateUrlWithState(state);
    fetchRecords();
  };

  if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearFilters);
  if (emptyClearBtn) emptyClearBtn.addEventListener('click', clearFilters);
  if (retryBtn) retryBtn.addEventListener('click', fetchRecords);

  // Popstate
  window.addEventListener('popstate', () => {
    const state = readStateFromUrl();
    syncControlsWithState(state);
    fetchRecords();
  });

  // Modal Flow
  const openDeleteModal = (evidenceId, evidenceName) => {
    pendingDeleteId = evidenceId;
    if (deleteEvidenceDisplay) {
      deleteEvidenceDisplay.textContent = `${evidenceId} ("${evidenceName}")`;
    }
    if (deleteReasonInput) {
      deleteReasonInput.value = '';
    }
    if (deleteReasonError) {
      deleteReasonError.textContent = '';
      deleteReasonError.style.display = 'none';
    }
    if (confirmDeleteBtn) {
      confirmDeleteBtn.disabled = false;
      confirmDeleteBtn.textContent = 'Delete Record';
    }
    if (deleteModal) {
      deleteModal.classList.add('active');
      setTimeout(() => deleteReasonInput?.focus(), 50);
    }
  };

  const closeDeleteModal = () => {
    pendingDeleteId = null;
    if (deleteModal) deleteModal.classList.remove('active');
  };

  if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', closeDeleteModal);
  if (deleteModal) {
    deleteModal.addEventListener('click', (e) => {
      if (e.target === deleteModal) closeDeleteModal();
    });
  }

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async () => {
      if (!pendingDeleteId) return;

      const reason = deleteReasonInput?.value?.trim() || '';
      if (reason.length < 5 || reason.length > 300) {
        if (deleteReasonError) {
          deleteReasonError.textContent = 'Please provide a valid deletion reason (between 5 and 300 characters).';
          deleteReasonError.style.display = 'block';
        }
        deleteReasonInput?.focus();
        return;
      }

      if (deleteReasonError) deleteReasonError.style.display = 'none';
      confirmDeleteBtn.disabled = true;
      confirmDeleteBtn.textContent = 'Deleting...';

      try {
        await EG.api.del(`/api/evidence/${encodeURIComponent(pendingDeleteId)}`, { reason });
        closeDeleteModal();
        EG.utils.toast(`Evidence record ${pendingDeleteId} has been soft-deleted and stored file removed.`, 'success');
        fetchRecords();
      } catch (err) {
        console.error('[Delete Error]', err);
        if (deleteReasonError) {
          deleteReasonError.textContent = err.message || 'Failed to delete evidence';
          deleteReasonError.style.display = 'block';
        }
        confirmDeleteBtn.disabled = false;
        confirmDeleteBtn.textContent = 'Delete Record';
      }
    });
  }

  // Initial load
  const initialState = readStateFromUrl();
  syncControlsWithState(initialState);
  fetchRecords();
}

function initEvidenceDetails() {
  EG.auth.requireAuth('login.html');
  const user = EG.auth.getUser();

  const loadingEl = document.getElementById('detailsLoading');
  const notFoundEl = document.getElementById('detailsNotFound');
  const contentEl = document.getElementById('detailsContent');

  const btnVerify = document.getElementById('btnVerifyEvidence');
  const btnAudit = document.getElementById('btnViewAudit');

  const detEvidenceId = document.getElementById('detEvidenceId');
  const detCaseId = document.getElementById('detCaseId');
  const detEvidenceName = document.getElementById('detEvidenceName');
  const detStatusBadge = document.getElementById('detStatusBadge');
  const detTypeBadge = document.getElementById('detTypeBadge');
  const detDescription = document.getElementById('detDescription');
  const detFileName = document.getElementById('detFileName');
  const detFileSize = document.getElementById('detFileSize');
  const detMimeType = document.getElementById('detMimeType');
  const detUploadedBy = document.getElementById('detUploadedBy');
  const detCreatedAt = document.getElementById('detCreatedAt');
  const detVerifiedAt = document.getElementById('detVerifiedAt');
  const detHash = document.getElementById('detHash');

  const detBlockContainer = document.getElementById('detBlockContainer');
  const detNoBlockContainer = document.getElementById('detNoBlockContainer');
  const detBlockNumber = document.getElementById('detBlockNumber');
  const detBlockTime = document.getElementById('detBlockTime');
  const detPrevHash = document.getElementById('detPrevHash');
  const detCurrentHash = document.getElementById('detCurrentHash');

  const verificationsTbody = document.getElementById('verificationsTbody');
  const verificationsCount = document.getElementById('verificationsCount');
  const noVerificationsMsg = document.getElementById('noVerificationsMsg');

  const copyHashBtn = document.getElementById('copyHashBtn');
  const copyPrevHashBtn = document.getElementById('copyPrevHashBtn');
  const copyCurrentHashBtn = document.getElementById('copyCurrentHashBtn');

  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get('id');
  const caseId = urlParams.get('caseId');
  const identifier = id || caseId;

  if (!identifier) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (notFoundEl) notFoundEl.style.display = 'block';
    return;
  }

  const loadDetails = async () => {
    try {
      const res = await EG.api.get(`/api/evidence/${encodeURIComponent(identifier)}`);
      const data = res.data || res;

      if (!data || !data.evidenceId) {
        throw new Error('Evidence record not found');
      }

      if (loadingEl) loadingEl.style.display = 'none';
      if (contentEl) contentEl.style.display = 'block';

      // Action buttons
      if (btnVerify) {
        btnVerify.href = `verify.html?evidenceId=${encodeURIComponent(data.evidenceId)}`;
        btnVerify.style.display = 'inline-flex';
      }

      if (btnAudit) {
        if (user && ['ADMIN', 'INVESTIGATOR'].includes(user.role)) {
          btnAudit.href = `audit.html?evidenceId=${encodeURIComponent(data.evidenceId)}`;
          btnAudit.style.display = 'inline-flex';
        } else {
          btnAudit.style.display = 'none';
        }
      }

      const btnDownload = document.getElementById('btnDownloadAsset');
      if (btnDownload) {
        btnDownload.style.display = 'inline-flex';
        btnDownload.onclick = () => {
          window.location.href = `/api/evidence/${encodeURIComponent(data.evidenceId)}/download`;
          EG.utils.toast('Downloading evidence file... (Custody ACCESSED event recorded)', 'info');
          setTimeout(() => {
            if (typeof loadCustody === 'function') loadCustody(data.evidenceId);
          }, 1500);
        };
      }

      const btnGenerateQr = document.getElementById('btnGenerateQr');
      const qrModal = document.getElementById('qrModal');
      const closeQrModalBtn = document.getElementById('closeQrModalBtn');
      const qrLocalhostWarning = document.getElementById('qrLocalhostWarning');
      const qrImage = document.getElementById('qrImage');
      const qrPrintCaseId = document.getElementById('qrPrintCaseId');
      const qrPrintEvidenceId = document.getElementById('qrPrintEvidenceId');
      const qrUrlInput = document.getElementById('qrUrlInput');
      const copyQrUrlBtn = document.getElementById('copyQrUrlBtn');
      const downloadPngBtn = document.getElementById('downloadPngBtn');
      const printQrBtn = document.getElementById('printQrBtn');

      if (btnGenerateQr) {
        btnGenerateQr.style.display = 'inline-flex';
        btnGenerateQr.onclick = async () => {
          btnGenerateQr.disabled = true;
          btnGenerateQr.textContent = 'Generating...';
          try {
            const qrRes = await EG.api.get(`/api/evidence/${encodeURIComponent(data.evidenceId)}/qr`);
            if (qrRes && qrRes.success) {
              if (qrImage) qrImage.src = qrRes.pngDataUrl;
              if (qrUrlInput) qrUrlInput.value = qrRes.url;
              if (qrPrintCaseId) qrPrintCaseId.textContent = `Case: ${qrRes.caseId}`;
              if (qrPrintEvidenceId) qrPrintEvidenceId.textContent = `Evidence: ${qrRes.evidenceId}`;

              if (qrLocalhostWarning) {
                if (qrRes.url.includes('localhost')) {
                  qrLocalhostWarning.style.display = 'block';
                } else {
                  qrLocalhostWarning.style.display = 'none';
                }
              }

              if (downloadPngBtn) {
                downloadPngBtn.onclick = () => {
                  const a = document.createElement('a');
                  a.href = qrRes.pngDataUrl;
                  a.download = `${qrRes.evidenceId}-verification-qr.png`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                };
              }

              if (printQrBtn) {
                printQrBtn.onclick = () => {
                  window.print();
                };
              }

              if (copyQrUrlBtn) {
                copyQrUrlBtn.onclick = () => {
                  navigator.clipboard.writeText(qrRes.url).then(() => {
                    EG.utils.toast('Verification URL copied to clipboard', 'info');
                  });
                };
              }

              if (qrModal) qrModal.classList.add('active');
            } else {
              EG.utils.toast(qrRes.message || 'Failed to generate QR', 'error');
            }
          } catch (err) {
            console.error('[QR Error]', err);
            EG.utils.toast(err.message || 'Failed to generate QR code', 'error');
          } finally {
            btnGenerateQr.disabled = false;
            btnGenerateQr.textContent = 'ðŸ“± Generate QR';
          }
        };
      }

      const closeQrModal = () => {
        if (qrModal) qrModal.classList.remove('active');
      };
      if (closeQrModalBtn) closeQrModalBtn.onclick = closeQrModal;
      if (qrModal) {
        qrModal.onclick = (e) => {
          if (e.target === qrModal) closeQrModal();
        };
      }

      // Safe text assignments
      if (detEvidenceId) {
        detEvidenceId.textContent = data.evidenceId;
        if (data.isDemo) {
          const demoBadge = document.createElement('span');
          demoBadge.className = 'badge badge-demo';
          demoBadge.textContent = 'DEMO';
          demoBadge.style.cssText = 'margin-left:8px; font-size:0.72rem; padding:2px 6px; background:rgba(0,212,255,0.15); color:var(--accent-cyan); border:1px solid var(--accent-cyan); border-radius:4px; vertical-align:middle; font-weight:700; letter-spacing:0.5px;';
          detEvidenceId.appendChild(demoBadge);
        }
      }
      if (detCaseId) detCaseId.textContent = data.caseId;
      if (detEvidenceName) detEvidenceName.textContent = data.name || 'Untitled';
      if (detTypeBadge) detTypeBadge.textContent = data.type || 'Other';
      if (detStatusBadge) {
        detStatusBadge.className = `badge badge-${(data.status || 'pending').toLowerCase()}`;
        detStatusBadge.textContent = data.status || 'Pending';
      }
      if (detDescription) detDescription.textContent = data.description || 'No description provided for this evidence record.';
      if (detFileName) detFileName.textContent = data.fileName || 'N/A';
      if (detFileSize) detFileSize.textContent = EG.utils.formatBytes(data.fileSize);
      if (detMimeType) detMimeType.textContent = data.mimeType || 'unknown';
      if (detUploadedBy) detUploadedBy.textContent = data.uploadedByName || 'Unknown';
      if (detCreatedAt) detCreatedAt.textContent = EG.utils.formatDate(data.createdAt);
      if (detVerifiedAt) detVerifiedAt.textContent = data.verifiedAt ? EG.utils.formatDate(data.verifiedAt) : 'Not verified yet';
      if (detHash) detHash.textContent = data.hash || '';

      if (copyHashBtn && data.hash) {
        copyHashBtn.onclick = () => {
          navigator.clipboard.writeText(data.hash).then(() => {
            EG.utils.toast('SHA-256 hash copied to clipboard', 'info');
          });
        };
      }

      // Block details
      if (data.block && data.block.blockNumber != null) {
        if (detBlockContainer) detBlockContainer.style.display = 'block';
        if (detNoBlockContainer) detNoBlockContainer.style.display = 'none';

        if (detBlockNumber) detBlockNumber.textContent = `Block #${data.block.blockNumber}`;
        if (detBlockTime) detBlockTime.textContent = EG.utils.formatDate(data.block.timestamp);
        if (detPrevHash) detPrevHash.textContent = data.block.previousHash || '';
        if (detCurrentHash) detCurrentHash.textContent = data.block.currentHash || '';

        if (copyPrevHashBtn && data.block.previousHash) {
          copyPrevHashBtn.onclick = () => {
            navigator.clipboard.writeText(data.block.previousHash).then(() => {
              EG.utils.toast('Previous block hash copied', 'info');
            });
          };
        }
        if (copyCurrentHashBtn && data.block.currentHash) {
          copyCurrentHashBtn.onclick = () => {
            navigator.clipboard.writeText(data.block.currentHash).then(() => {
              EG.utils.toast('Current block hash copied', 'info');
            });
          };
        }
      } else {
        if (detBlockContainer) detBlockContainer.style.display = 'none';
        if (detNoBlockContainer) detNoBlockContainer.style.display = 'block';
      }

      // Fetch verifications
      loadVerifications(data.evidenceId);

      // Sprint 12: Chain of Custody Timeline & Handover Management
      loadCustody(data.evidenceId);

    } catch (err) {
      console.error('[Evidence Details]', err);
      if (loadingEl) loadingEl.style.display = 'none';
      if (contentEl) contentEl.style.display = 'none';
      if (notFoundEl) notFoundEl.style.display = 'block';
    }
  };

  const loadVerifications = async (evId) => {
    try {
      const res = await EG.api.get(`/api/evidence/${encodeURIComponent(evId)}/verifications`);
      const items = res.data || [];

      if (!items || items.length === 0) {
        if (verificationsTbody) verificationsTbody.innerHTML = '';
        if (noVerificationsMsg) noVerificationsMsg.style.display = 'block';
        if (verificationsCount) verificationsCount.textContent = '0 verifications';
        return;
      }

      if (noVerificationsMsg) noVerificationsMsg.style.display = 'none';
      if (verificationsCount) verificationsCount.textContent = `${items.length} verification(s) recorded`;

      if (verificationsTbody) {
        verificationsTbody.innerHTML = items.map(v => {
          const vId = escapeHtml(v.verificationId || 'VER-???');
          const vDate = EG.utils.formatDate(v.verifiedAt);
          const vResultBadge = `<span class="badge badge-${(v.result || '').toLowerCase()}">${escapeHtml(v.result || '')}</span>`;
          const fInfo = `${escapeHtml(v.submittedFileName || 'N/A')} (${EG.utils.formatBytes(v.submittedFileSize)})`;
          const chainText = v.chainConsistent ? '<span style="color: var(--status-verified);">âœ… Consistent</span>' : '<span style="color: var(--status-tampered);">âŒ Broken</span>';
          const vUser = escapeHtml(v.verifiedByName || 'Unknown');
          const vIp = escapeHtml(v.ipAddress || 'unknown');

          return `
            <tr>
              <td data-label="Verification ID" style="font-family: monospace; font-weight: 600;">${vId}</td>
              <td data-label="Date & Time" style="color: var(--text-muted); font-size: 0.85rem;">${vDate}</td>
              <td data-label="Result">${vResultBadge}</td>
              <td data-label="Submitted File" style="font-size: 0.9rem;">${fInfo}</td>
              <td data-label="Chain Consistent">${chainText}</td>
              <td data-label="Verified By">${vUser}</td>
              <td data-label="IP Address" style="font-family: monospace; font-size: 0.8rem; color: var(--text-muted);">${vIp}</td>
            </tr>
          `;
        }).join('');
      }
    } catch (vErr) {
      console.error('[Verifications]', vErr);
      if (noVerificationsMsg) {
        noVerificationsMsg.textContent = 'Could not load verification history.';
        noVerificationsMsg.style.display = 'block';
      }
    }
  };

  // ─── Sprint 12: Chain of Custody Lifecycle & Handover Management ──────────
  let currentExpectedSeq = 1;
  let cachedOfficers = [];
  let pendingCustodyIdForReject = null;

  const loadOfficers = async (selectEl, currentUserId) => {
    try {
      if (cachedOfficers.length === 0) {
        const res = await EG.api.get('/api/custody/officers');
        cachedOfficers = (res && res.officers) || [];
      }
      selectEl.innerHTML = '<option value="">-- Select Officer --</option>';
      cachedOfficers.forEach(off => {
        if (currentUserId && String(off._id) === String(currentUserId)) return;
        const opt = document.createElement('option');
        opt.value = off._id;
        opt.textContent = `${off.name} (${off.role})`;
        selectEl.appendChild(opt);
      });
    } catch (err) {
      console.error('[Load Officers Error]', err);
      selectEl.innerHTML = '<option value="">Failed to load officers</option>';
    }
  };

  // Modal references
  const transferModal = document.getElementById('transferModal');
  const logActionModal = document.getElementById('logActionModal');
  const releaseModal = document.getElementById('releaseModal');
  const returnModal = document.getElementById('returnModal');
  const rejectModal = document.getElementById('rejectModal');

  // Modal Close buttons
  document.getElementById('closeTransferModalBtn')?.addEventListener('click', () => transferModal?.classList.remove('active'));
  document.getElementById('cancelTransferBtn')?.addEventListener('click', () => transferModal?.classList.remove('active'));
  document.getElementById('closeLogActionModalBtn')?.addEventListener('click', () => logActionModal?.classList.remove('active'));
  document.getElementById('cancelLogActionBtn')?.addEventListener('click', () => logActionModal?.classList.remove('active'));
  document.getElementById('closeReleaseModalBtn')?.addEventListener('click', () => releaseModal?.classList.remove('active'));
  document.getElementById('cancelReleaseBtn')?.addEventListener('click', () => releaseModal?.classList.remove('active'));
  document.getElementById('closeReturnModalBtn')?.addEventListener('click', () => returnModal?.classList.remove('active'));
  document.getElementById('cancelReturnBtn')?.addEventListener('click', () => returnModal?.classList.remove('active'));
  document.getElementById('closeRejectModalBtn')?.addEventListener('click', () => rejectModal?.classList.remove('active'));
  document.getElementById('cancelRejectBtn')?.addEventListener('click', () => rejectModal?.classList.remove('active'));

  // Action Button Openers
  document.getElementById('btnCustodyTransfer')?.addEventListener('click', async () => {
    const selectEl = document.getElementById('transferRecipientSelect');
    const currentUserIdStr = user?._id || user?.id;
    if (selectEl) await loadOfficers(selectEl, currentUserIdStr);
    const reasonInput = document.getElementById('transferReason');
    const locInput = document.getElementById('transferLocation');
    const condInput = document.getElementById('transferCondition');
    if (reasonInput) reasonInput.value = '';
    if (locInput) locInput.value = '';
    if (condInput) condInput.value = '';
    transferModal?.classList.add('active');
  });

  document.getElementById('btnCustodyLogAction')?.addEventListener('click', () => {
    const rEl = document.getElementById('logActionReason');
    const lEl = document.getElementById('logActionLocation');
    const cEl = document.getElementById('logActionCondition');
    if (rEl) rEl.value = '';
    if (lEl) lEl.value = '';
    if (cEl) cEl.value = '';
    logActionModal?.classList.add('active');
  });

  document.getElementById('btnCustodyRelease')?.addEventListener('click', () => {
    const nEl = document.getElementById('releasePartyName');
    const oEl = document.getElementById('releasePartyOrg');
    const rEl = document.getElementById('releaseReason');
    const lEl = document.getElementById('releaseLocation');
    if (nEl) nEl.value = '';
    if (oEl) oEl.value = '';
    if (rEl) rEl.value = '';
    if (lEl) lEl.value = '';
    releaseModal?.classList.add('active');
  });

  document.getElementById('btnCustodyReturn')?.addEventListener('click', async () => {
    const selectEl = document.getElementById('returnOfficerSelect');
    if (selectEl) await loadOfficers(selectEl);
    const rEl = document.getElementById('returnReason');
    const lEl = document.getElementById('returnLocation');
    if (rEl) rEl.value = '';
    if (lEl) lEl.value = '';
    returnModal?.classList.add('active');
  });

  document.getElementById('btnRefreshCustody')?.addEventListener('click', () => {
    if (identifier) loadCustody(identifier);
  });

  // Transfer Form Submit
  document.getElementById('transferForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const toUserId = document.getElementById('transferRecipientSelect')?.value;
    const reason = document.getElementById('transferReason')?.value?.trim();
    const location = document.getElementById('transferLocation')?.value?.trim();
    const conditionNotes = document.getElementById('transferCondition')?.value?.trim();

    if (!toUserId) {
      EG.utils.toast('Please select a recipient officer.', 'error');
      return;
    }
    if (!reason || reason.length < 5) {
      EG.utils.toast('Reason must be at least 5 characters.', 'error');
      return;
    }

    const btnSubmit = document.getElementById('submitTransferBtn');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      await EG.api.post(`/api/evidence/${encodeURIComponent(identifier)}/custody`, {
        type: 'TRANSFER_INITIATED',
        toUserId,
        reason,
        location,
        conditionNotes,
        expectedSeq: currentExpectedSeq
      });
      EG.utils.toast('Custody transfer successfully initiated! Recipient notified.', 'success');
      transferModal?.classList.remove('active');
      loadCustody(identifier);
    } catch (err) {
      EG.utils.toast(err.message || 'Failed to initiate custody transfer', 'error');
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  // Log Action Form Submit
  document.getElementById('logActionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('logActionTypeSelect')?.value;
    const reason = document.getElementById('logActionReason')?.value?.trim();
    const location = document.getElementById('logActionLocation')?.value?.trim();
    const conditionNotes = document.getElementById('logActionCondition')?.value?.trim();

    if (!reason || reason.length < 5) {
      EG.utils.toast('Activity summary must be at least 5 characters.', 'error');
      return;
    }

    const btnSubmit = document.getElementById('submitLogActionBtn');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      await EG.api.post(`/api/evidence/${encodeURIComponent(identifier)}/custody`, {
        type,
        reason,
        location,
        conditionNotes,
        expectedSeq: currentExpectedSeq
      });
      EG.utils.toast(`Custody activity [${type}] successfully recorded!`, 'success');
      logActionModal?.classList.remove('active');
      loadCustody(identifier);
    } catch (err) {
      EG.utils.toast(err.message || 'Failed to record activity', 'error');
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  // Release Form Submit
  document.getElementById('releaseForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('releasePartyName')?.value?.trim();
    const organization = document.getElementById('releasePartyOrg')?.value?.trim();
    const reason = document.getElementById('releaseReason')?.value?.trim();
    const location = document.getElementById('releaseLocation')?.value?.trim();

    if (!name || !organization) {
      EG.utils.toast('External party name and organization are required.', 'error');
      return;
    }
    if (!reason || reason.length < 5) {
      EG.utils.toast('Reason must be at least 5 characters.', 'error');
      return;
    }

    const btnSubmit = document.getElementById('submitReleaseBtn');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      await EG.api.post(`/api/evidence/${encodeURIComponent(identifier)}/custody`, {
        type: 'RELEASED',
        externalParty: { name, organization },
        reason,
        location,
        expectedSeq: currentExpectedSeq
      });
      EG.utils.toast('Evidence released to external custody.', 'info');
      releaseModal?.classList.remove('active');
      loadCustody(identifier);
    } catch (err) {
      EG.utils.toast(err.message || 'Failed to release evidence', 'error');
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  // Return Form Submit (Admin)
  document.getElementById('returnForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const toUserId = document.getElementById('returnOfficerSelect')?.value;
    const reason = document.getElementById('returnReason')?.value?.trim();
    const location = document.getElementById('returnLocation')?.value?.trim();

    if (!toUserId) {
      EG.utils.toast('Please select an intake officer.', 'error');
      return;
    }
    if (!reason || reason.length < 5) {
      EG.utils.toast('Reason must be at least 5 characters.', 'error');
      return;
    }

    const btnSubmit = document.getElementById('submitReturnBtn');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      await EG.api.post(`/api/evidence/${encodeURIComponent(identifier)}/custody`, {
        type: 'RETURNED',
        toUserId,
        reason,
        location,
        expectedSeq: currentExpectedSeq
      });
      EG.utils.toast('Evidence successfully returned to agency custody!', 'success');
      returnModal?.classList.remove('active');
      loadCustody(identifier);
    } catch (err) {
      EG.utils.toast(err.message || 'Failed to return evidence to custody', 'error');
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  // Reject Form Submit
  document.getElementById('rejectForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = document.getElementById('rejectReasonInput')?.value?.trim();
    if (!reason || reason.length < 5) {
      EG.utils.toast('Please enter a rejection reason (min 5 characters).', 'error');
      return;
    }
    if (!pendingCustodyIdForReject) return;

    const btnSubmit = document.getElementById('submitRejectBtn');
    if (btnSubmit) btnSubmit.disabled = true;

    try {
      await EG.api.post(`/api/custody/${encodeURIComponent(pendingCustodyIdForReject)}/reject`, {
        reason,
        expectedSeq: currentExpectedSeq
      });
      EG.utils.toast('Custody transfer declined.', 'info');
      rejectModal?.classList.remove('active');
      pendingCustodyIdForReject = null;
      loadCustody(identifier);
    } catch (err) {
      EG.utils.toast(err.message || 'Failed to reject transfer', 'error');
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  // Validate Custody Chain Button
  const btnValidateCustody = document.getElementById('btnValidateCustody');
  if (btnValidateCustody) {
    btnValidateCustody.onclick = async () => {
      btnValidateCustody.disabled = true;
      btnValidateCustody.textContent = 'Verifying Chain...';
      try {
        const valRes = await EG.api.post(`/api/evidence/${encodeURIComponent(identifier)}/custody/validate`);
        const validationBadge = document.getElementById('detCustodyValidationBadge');
        if (valRes && valRes.valid) {
          EG.utils.toast(`✅ Custody Chain Cryptographically Valid: ${valRes.totalEvents} events intact, 0 issues.`, 'success');
          if (validationBadge) {
            validationBadge.style.display = 'inline-block';
            validationBadge.style.cssText = 'background: rgba(0, 196, 140, 0.15); color: #00c48c; border: 1px solid #00c48c; font-size: 0.75rem;';
            validationBadge.textContent = `✔ Chain Valid (${valRes.totalEvents}/${valRes.totalEvents})`;
          }
        } else {
          const issueMsg = (valRes.issues || []).map(i => i.message).join('; ');
          EG.utils.toast(`⚠️ Tamper Detected in Custody Chain! Issues: ${issueMsg}`, 'error');
          if (validationBadge) {
            validationBadge.style.display = 'inline-block';
            validationBadge.style.cssText = 'background: rgba(255, 76, 76, 0.15); color: #ff4c4c; border: 1px solid #ff4c4c; font-size: 0.75rem;';
            validationBadge.textContent = '⚠️ Tamper Detected';
          }
        }
      } catch (valErr) {
        EG.utils.toast(valErr.message || 'Failed to validate custody chain', 'error');
      } finally {
        btnValidateCustody.disabled = false;
        btnValidateCustody.textContent = '🛡 Validate Custody';
      }
    };
  }

  // Master loadCustody implementation
  const loadCustody = async (evId) => {
    try {
      const res = await EG.api.get(`/api/evidence/${encodeURIComponent(evId)}/custody`);
      if (!res || !res.success) return;

      const banner = document.getElementById('custodyBanner');
      const timelineCard = document.getElementById('custodyTimelineCard');
      const statusBadge = document.getElementById('detCustodyStatusBadge');
      const custodianName = document.getElementById('detCustodianName');
      const pendingAlert = document.getElementById('custodyPendingAlert');
      const pendingTitle = document.getElementById('custodyPendingTitle');
      const pendingDesc = document.getElementById('custodyPendingDesc');
      const pendingMeta = document.getElementById('custodyPendingMeta');
      const pendingActions = document.getElementById('custodyPendingActions');
      const eventsCount = document.getElementById('custodyEventsCount');
      const timeline = document.getElementById('custodyTimeline');
      const noCustodyMsg = document.getElementById('noCustodyMsg');

      const btnTransfer = document.getElementById('btnCustodyTransfer');
      const btnLogAction = document.getElementById('btnCustodyLogAction');
      const btnRelease = document.getElementById('btnCustodyRelease');
      const btnReturn = document.getElementById('btnCustodyReturn');
      const btnValidate = document.getElementById('btnValidateCustody');

      if (banner) banner.style.display = 'flex';
      if (timelineCard) timelineCard.style.display = 'block';
      if (btnValidate) btnValidate.style.display = 'inline-flex';

      const events = res.events || [];
      currentExpectedSeq = events.length + 1;

      // Status Badge
      if (statusBadge) {
        statusBadge.className = '';
        if (res.status === 'IN_CUSTODY') {
          statusBadge.className = 'custody-badge-incustody';
          statusBadge.innerHTML = '✔ IN CUSTODY';
        } else if (res.status === 'PENDING_TRANSFER') {
          statusBadge.className = 'custody-badge-pending';
          statusBadge.innerHTML = '⏳ PENDING TRANSFER';
        } else if (res.status === 'RELEASED') {
          statusBadge.className = 'custody-badge-released';
          statusBadge.innerHTML = '🏛️ RELEASED';
        } else {
          statusBadge.className = 'badge';
          statusBadge.textContent = res.status;
        }
      }

      // Custodian Label
      if (custodianName) {
        if (res.status === 'RELEASED') {
          const ext = res.externalParty;
          if (ext && (ext.name || ext.organization)) {
            custodianName.textContent = `${ext.name || 'External Party'} (${ext.organization || 'External Agency'}) [External]`;
          } else {
            custodianName.textContent = 'External Release (Held Externally)';
          }
          custodianName.style.color = '#ce93d8';
        } else if (res.currentCustodian) {
          custodianName.textContent = res.currentCustodian.name || 'Assigned Officer';
          custodianName.style.color = 'var(--accent-cyan)';
        } else {
          custodianName.textContent = 'None Assigned';
        }
      }

      const currentUserIdStr = user?._id ? String(user._id) : (user?.id ? String(user.id) : '');
      const isAdmin = user?.role === 'ADMIN';
      const isCustodian = res.currentCustodian && (String(res.currentCustodian.userId) === currentUserIdStr);

      // Buttons visibility
      if (btnTransfer) {
        btnTransfer.style.display = (res.status === 'IN_CUSTODY' && (isCustodian || isAdmin)) ? 'inline-flex' : 'none';
      }
      if (btnLogAction) {
        btnLogAction.style.display = (res.status === 'IN_CUSTODY' && (isCustodian || isAdmin)) ? 'inline-flex' : 'none';
      }
      if (btnRelease) {
        btnRelease.style.display = (res.status === 'IN_CUSTODY' && (isCustodian || isAdmin)) ? 'inline-flex' : 'none';
      }
      if (btnReturn) {
        btnReturn.style.display = (res.status === 'RELEASED' && isAdmin) ? 'inline-flex' : 'none';
      }

      // Pending Transfer Alert
      if (res.pendingTransfer && !res.pendingTransfer.isExpired) {
        const pt = res.pendingTransfer;
        if (pendingAlert) pendingAlert.style.display = 'flex';
        if (pendingTitle) pendingTitle.textContent = 'Custody Handover Pending';
        if (pendingDesc) {
          pendingDesc.innerHTML = `<strong>${escapeHtml(pt.fromUserName)}</strong> initiated a transfer to <strong>${escapeHtml(pt.toUserName)}</strong>.<br><span style="color:var(--text-muted); font-size:0.85rem;">Reason: "${escapeHtml(pt.reason)}"</span>`;
        }
        if (pendingMeta && pt.expiresAt) {
          const diffMs = new Date(pt.expiresAt) - new Date();
          const hoursLeft = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
          const minsLeft = Math.max(0, Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)));
          pendingMeta.textContent = `Expires in ${hoursLeft}h ${minsLeft}m (automatic 72h limit)`;
        }

        if (pendingActions) {
          pendingActions.innerHTML = '';
          const isRecipient = String(pt.toUserId) === currentUserIdStr;
          const isInitiator = String(pt.fromUserId) === currentUserIdStr;

          if (isRecipient || isAdmin) {
            const btnAccept = document.createElement('button');
            btnAccept.type = 'button';
            btnAccept.className = 'btn btn-primary';
            btnAccept.style.cssText = 'background: #00c48c; border: none; font-size: 0.85rem; padding: 0.4rem 0.85rem;';
            btnAccept.textContent = '✅ Accept Custody';
            btnAccept.onclick = async () => {
              if (!confirm(`Assume legal and physical custody of evidence ${evId}?`)) return;
              btnAccept.disabled = true;
              try {
                await EG.api.post(`/api/custody/${encodeURIComponent(pt.custodyId)}/accept`, {
                  reason: 'Custody transfer accepted and physical custody assumed',
                  expectedSeq: currentExpectedSeq
                });
                EG.utils.toast('Custody successfully assumed!', 'success');
                loadCustody(evId);
              } catch (aErr) {
                EG.utils.toast(aErr.message || 'Failed to accept custody', 'error');
                btnAccept.disabled = false;
              }
            };
            pendingActions.appendChild(btnAccept);

            const btnReject = document.createElement('button');
            btnReject.type = 'button';
            btnReject.className = 'btn btn-secondary';
            btnReject.style.cssText = 'border-color: #ff4c4c; color: #ff4c4c; font-size: 0.85rem; padding: 0.4rem 0.85rem;';
            btnReject.textContent = '⛔ Decline';
            btnReject.onclick = () => {
              pendingCustodyIdForReject = pt.custodyId;
              const rInp = document.getElementById('rejectReasonInput');
              if (rInp) rInp.value = '';
              rejectModal?.classList.add('active');
            };
            pendingActions.appendChild(btnReject);
          }

          if (isInitiator || isAdmin) {
            const btnCancel = document.createElement('button');
            btnCancel.type = 'button';
            btnCancel.className = 'btn btn-secondary';
            btnCancel.style.cssText = 'font-size: 0.85rem; padding: 0.4rem 0.85rem;';
            btnCancel.textContent = '🚫 Cancel Transfer';
            btnCancel.onclick = async () => {
              if (!confirm('Cancel this pending custody transfer?')) return;
              btnCancel.disabled = true;
              try {
                await EG.api.post(`/api/custody/${encodeURIComponent(pt.custodyId)}/cancel`, {
                  reason: 'Custody transfer cancelled by officer',
                  expectedSeq: currentExpectedSeq
                });
                EG.utils.toast('Custody transfer cancelled', 'info');
                loadCustody(evId);
              } catch (cErr) {
                EG.utils.toast(cErr.message || 'Failed to cancel transfer', 'error');
                btnCancel.disabled = false;
              }
            };
            pendingActions.appendChild(btnCancel);
          }
        }
      } else {
        if (pendingAlert) pendingAlert.style.display = 'none';
      }

      // Render Timeline
      if (eventsCount) eventsCount.textContent = `${events.length} event(s)`;
      if (events.length === 0) {
        if (timeline) timeline.innerHTML = '';
        if (noCustodyMsg) noCustodyMsg.style.display = 'block';
        return;
      }
      if (noCustodyMsg) noCustodyMsg.style.display = 'none';

      if (timeline) {
        timeline.innerHTML = events.map(evt => {
          const seq = evt.seq;
          const type = evt.type;
          const actor = escapeHtml(evt.actorName || 'Officer');
          const toUser = evt.toUserName ? ` → <strong>${escapeHtml(evt.toUserName)}</strong>` : '';
          const extParty = (evt.externalParty && evt.externalParty.name)
            ? ` → 🏛️ <strong>${escapeHtml(evt.externalParty.name)} (${escapeHtml(evt.externalParty.organization || '')})</strong>`
            : '';
          const dateStr = EG.utils.formatDate(evt.occurredAt);
          const reason = escapeHtml(evt.reason);
          const loc = evt.location ? `📍 ${escapeHtml(evt.location)}` : '';
          const notes = evt.conditionNotes ? `📝 ${escapeHtml(evt.conditionNotes)}` : '';
          const hashShort = evt.entryHash ? evt.entryHash.slice(0, 16) + '...' + evt.entryHash.slice(-8) : '';
          const autoBadge = evt.auto ? '<span class="badge" style="background:rgba(59,130,246,0.2); color:#60a5fa; border:1px solid #3b82f6; font-size:0.7rem; padding:1px 5px; margin-left:6px;">AUTO</span>' : '';

          let typeIcon = '📋';
          if (type === 'COLLECTED') typeIcon = '📥';
          else if (type === 'TRANSFER_INITIATED') typeIcon = '⏳';
          else if (type === 'TRANSFER_ACCEPTED') typeIcon = '🤝';
          else if (type === 'TRANSFER_REJECTED') typeIcon = '⛔';
          else if (type === 'TRANSFER_CANCELLED') typeIcon = '🚫';
          else if (type === 'ACCESSED') typeIcon = '👁️';
          else if (type === 'ANALYZED') typeIcon = '🔬';
          else if (type === 'STORED') typeIcon = '🗄️';
          else if (type === 'RELEASED') typeIcon = '🏛️';
          else if (type === 'RETURNED') typeIcon = '↩️';

          return `
            <div class="custody-step">
              <div class="custody-node">${seq}</div>
              <div class="custody-card">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span class="custody-type-badge type-${type}">${typeIcon} ${type}</span>
                    ${autoBadge}
                  </div>
                  <div style="font-size:0.82rem; color:var(--text-muted);">${dateStr}</div>
                </div>

                <div style="font-size:0.95rem; margin-bottom:6px;">
                  <span>Officer: <strong>${actor}</strong></span>${toUser}${extParty}
                </div>

                <div style="color:var(--text-main); font-size:0.9rem; margin-bottom:8px; line-height:1.4;">
                  ${reason}
                </div>

                ${(loc || notes) ? `
                  <div style="display:flex; gap:14px; font-size:0.82rem; color:var(--text-muted); flex-wrap:wrap; margin-bottom:8px;">
                    ${loc ? `<span>${loc}</span>` : ''}
                    ${notes ? `<span>${notes}</span>` : ''}
                  </div>
                ` : ''}

                <div class="custody-hash-display">
                  <span style="color:var(--text-muted);">SHA-256 Seal:</span>
                  <span style="color:var(--accent-cyan); word-break:break-all; flex:1;" title="${evt.entryHash}">${hashShort}</span>
                  <button type="button" class="btn-copy-sm" onclick="navigator.clipboard.writeText('${evt.entryHash}').then(() => EG.utils.toast('Custody hash copied', 'info'))">Copy</button>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }

    } catch (cErr) {
      console.warn('[Custody Not Available / Disabled]', cErr.message);
    }
  };

  loadDetails();
}

function initAudit() {
  EG.auth.requireAuth('login.html');

  // Prevent default form submit (removed onsubmit attr for CSP compliance)
  const filterForm = document.getElementById('auditFilterForm');
  if (filterForm) filterForm.addEventListener('submit', e => e.preventDefault());

  if (!EG.auth.canViewAudit()) {
    EG.utils.toast('Access Denied: VIEWER role cannot view audit trails.', 'error');
    window.location.href = 'dashboard.html';
    return;
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

  const user = EG.auth.getUser();
  const isAdmin = EG.auth.isAdmin();
  const topbarRoleEl = document.getElementById('topbarRoleBadge');
  if (topbarRoleEl && user) {
    topbarRoleEl.textContent = user.role || 'INVESTIGATOR';
    if (user.role === 'ADMIN') topbarRoleEl.className = 'badge badge-tampered';
    else if (user.role === 'INVESTIGATOR') topbarRoleEl.className = 'badge badge-pending';
    else topbarRoleEl.className = 'badge badge-verified';
  }

  // Hide admin elements if not admin
  if (!isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    const thIp = document.getElementById('thIpAddress');
    if (thIp) thIp.style.display = 'none';
  } else {
    document.querySelectorAll('.admin-only').forEach(el => {
      if (el.id === 'auditIntegrityPanel') el.style.display = 'flex';
      else el.style.display = 'block';
    });
  }

  // Parse URL search params
  const urlParams = new URLSearchParams(window.location.search);
  const state = {
    q: urlParams.get('q') || '',
    action: urlParams.get('action') || '',
    user: urlParams.get('user') || '',
    evidenceId: urlParams.get('evidenceId') || '',
    dateFrom: urlParams.get('dateFrom') || '',
    dateTo: urlParams.get('dateTo') || '',
    sortBy: urlParams.get('sortBy') || 'timestamp',
    sortOrder: urlParams.get('sortOrder') || 'desc',
    page: parseInt(urlParams.get('page'), 10) || 1,
    limit: parseInt(urlParams.get('limit'), 10) || 25
  };

  let brokenSeq = null;

  // DOM Elements
  const searchInput = document.getElementById('auditSearch');
  const actionSelect = document.getElementById('auditActionFilter');
  const userSelect = document.getElementById('auditUserFilter');
  const evidenceInput = document.getElementById('auditEvidenceId');
  const dateFromInput = document.getElementById('auditDateFrom');
  const dateToInput = document.getElementById('auditDateTo');
  const sortBySelect = document.getElementById('auditSortBy');
  const sortOrderSelect = document.getElementById('auditSortOrder');
  const pageSizeSelect = document.getElementById('auditPageSize');
  const btnReset = document.getElementById('btnResetAuditFilters');

  // Populate inputs from state
  if (searchInput) searchInput.value = state.q;
  if (evidenceInput) evidenceInput.value = state.evidenceId;
  if (dateFromInput) dateFromInput.value = state.dateFrom;
  if (dateToInput) dateToInput.value = state.dateTo;
  if (sortBySelect) sortBySelect.value = state.sortBy;
  if (sortOrderSelect) sortOrderSelect.value = state.sortOrder;
  if (pageSizeSelect) pageSizeSelect.value = String(state.limit);

  // Sync state to URL
  const syncUrl = () => {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.action) p.set('action', state.action);
    if (state.user) p.set('user', state.user);
    if (state.evidenceId) p.set('evidenceId', state.evidenceId);
    if (state.dateFrom) p.set('dateFrom', state.dateFrom);
    if (state.dateTo) p.set('dateTo', state.dateTo);
    if (state.sortBy !== 'timestamp') p.set('sortBy', state.sortBy);
    if (state.sortOrder !== 'desc') p.set('sortOrder', state.sortOrder);
    if (state.page > 1) p.set('page', state.page);
    if (state.limit !== 25) p.set('limit', state.limit);

    const newUrl = `${window.location.pathname}${p.toString() ? '?' + p.toString() : ''}`;
    window.history.replaceState(null, '', newUrl);
  };

  // Load Filters from API
  const loadFilters = async () => {
    try {
      const data = await EG.api.get('/api/audit/filters');
      if (data.success) {
        if (actionSelect && Array.isArray(data.actions)) {
          actionSelect.innerHTML = '<option value="">All Actions</option>';
          data.actions.forEach(act => {
            const opt = document.createElement('option');
            opt.value = act;
            opt.textContent = act;
            if (act === state.action) opt.selected = true;
            actionSelect.appendChild(opt);
          });
        }
        if (userSelect && Array.isArray(data.users)) {
          userSelect.innerHTML = '<option value="">All Users</option>';
          data.users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u;
            opt.textContent = u;
            if (u === state.user) opt.selected = true;
            userSelect.appendChild(opt);
          });
        }
      }
    } catch (err) {
      console.error('[AUDIT FILTERS LOAD]', err);
    }
  };

  // Fetch and render logs
  const loadAuditLogs = async () => {
    const tbody = document.getElementById('auditTbody');
    const emptyState = document.getElementById('auditEmptyState');
    const errorState = document.getElementById('auditErrorState');
    const countShowing = document.getElementById('auditCountShowing');
    const totalCount = document.getElementById('auditTotalCount');
    const pageIndicator = document.getElementById('auditPageIndicator');
    const paginationBtns = document.getElementById('auditPaginationBtns');

    if (emptyState) emptyState.style.display = 'none';
    if (errorState) errorState.style.display = 'none';

    // Show skeleton loaders
    if (tbody) {
      tbody.innerHTML = '';
      for (let i = 0; i < 5; i++) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span class="skeleton" style="width: 30px;"></span></td>
          <td><span class="skeleton" style="width: 80px;"></span></td>
          <td><span class="skeleton" style="width: 90px;"></span></td>
          <td><span class="skeleton" style="width: 80px;"></span></td>
          <td><span class="skeleton" style="width: 60px;"></span></td>
          <td><span class="skeleton" style="width: 70px;"></span></td>
          <td><span class="skeleton" style="width: 70px;"></span></td>
          <td><span class="skeleton" style="width: 90px;"></span></td>
          <td><span class="skeleton" style="width: 150px;"></span></td>
          ${isAdmin ? '<td><span class="skeleton" style="width: 80px;"></span></td>' : ''}
          <td><span class="skeleton" style="width: 40px;"></span></td>
        `;
        tbody.appendChild(tr);
      }
    }

    try {
      const qParams = new URLSearchParams();
      if (state.q) qParams.set('q', state.q);
      if (state.action) qParams.set('action', state.action);
      if (state.user) qParams.set('user', state.user);
      if (state.evidenceId) qParams.set('evidenceId', state.evidenceId);
      if (state.dateFrom) qParams.set('dateFrom', state.dateFrom);
      if (state.dateTo) qParams.set('dateTo', state.dateTo);
      qParams.set('sortBy', state.sortBy);
      qParams.set('sortOrder', state.sortOrder);
      qParams.set('page', state.page);
      qParams.set('limit', state.limit);

      const res = await EG.api.get(`/api/audit?${qParams.toString()}`);
      if (!res.success) throw new Error(res.message || 'Failed to fetch audit logs');

      const items = res.items || [];
      const total = res.total || 0;
      const totalPages = res.totalPages || 1;

      if (countShowing) countShowing.textContent = items.length.toLocaleString();
      if (totalCount) totalCount.textContent = total.toLocaleString();
      if (pageIndicator) pageIndicator.textContent = `Page ${state.page} of ${totalPages}`;

      if (tbody) tbody.innerHTML = '';

      if (items.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        if (paginationBtns) paginationBtns.innerHTML = '';
        return;
      }

      items.forEach(item => {
        const tr = document.createElement('tr');
        if (brokenSeq !== null && item.seq === brokenSeq) {
          tr.className = 'row-broken';
        }

        const seqText = item.seq !== null && item.seq !== undefined ? `#${item.seq}` : '-';
        const formattedDate = EG.utils.formatDate(item.timestamp);
        const actionHtml = `<span class="badge-action badge-action-${escapeHtml(item.action)}">${escapeHtml(item.action)}</span>`;
        const evidenceHtml = item.evidenceId
          ? `<a href="evidence-details.html?id=${encodeURIComponent(item.evidenceId)}" style="font-family:monospace; color:var(--accent-cyan); font-weight:600;">${escapeHtml(item.evidenceId)}</a>`
          : '<span style="color:var(--text-muted);">-</span>';
        const caseHtml = item.caseId
          ? `<span style="font-family:monospace; font-size:0.85rem;">${escapeHtml(item.caseId)}</span>`
          : '<span style="color:var(--text-muted);">-</span>';

        tr.innerHTML = `
          <td data-label="Seq" style="font-weight:600; color:var(--text-muted);">${escapeHtml(seqText)}</td>
          <td data-label="Time" style="white-space:nowrap; font-size:0.85rem;">${escapeHtml(formattedDate)}</td>
          <td data-label="Event ID"><span class="hash-pill">${escapeHtml(item.eventId || '-')}</span></td>
          <td data-label="User" style="font-weight:600;">${escapeHtml(item.userName || 'System')}</td>
          <td data-label="Role">${EG.utils.roleBadgeHtml(item.role)}</td>
          <td data-label="Action">${actionHtml}</td>
          <td data-label="Evidence">${evidenceHtml}</td>
          <td data-label="Case ID">${caseHtml}</td>
          <td data-label="Description" style="max-width:260px; font-size:0.85rem; line-height:1.3;">${escapeHtml(item.description || '-')}</td>
          ${isAdmin ? `<td data-label="IP Address" style="font-family:monospace; font-size:0.8rem; color:var(--text-muted);">${escapeHtml(item.ipAddress || '-')}</td>` : ''}
          <td data-label="Detail" style="text-align:right;">
            <button class="btn-sm btn-secondary btn-detail-trigger" style="padding:2px 8px; font-size:0.75rem;">View</button>
          </td>
        `;

        // Row click opens detail modal
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
          if (e.target.tagName === 'A') return; // let link handle navigation
          openDetailModal(item);
        });

        tbody.appendChild(tr);
      });

      // Render pagination
      if (paginationBtns) {
        paginationBtns.innerHTML = '';
        if (totalPages > 1) {
          const createBtn = (text, targetPage, disabled = false, active = false) => {
            const b = document.createElement('button');
            b.className = `page-btn ${active ? 'active' : ''}`;
            b.textContent = text;
            b.disabled = disabled;
            if (!disabled && !active) {
              b.onclick = () => {
                state.page = targetPage;
                syncUrl();
                loadAuditLogs();
              };
            }
            return b;
          };

          paginationBtns.appendChild(createBtn('Â«', 1, state.page === 1));
          paginationBtns.appendChild(createBtn('â€¹', state.page - 1, state.page === 1));

          const startP = Math.max(1, state.page - 2);
          const endP = Math.min(totalPages, state.page + 2);
          for (let p = startP; p <= endP; p++) {
            paginationBtns.appendChild(createBtn(String(p), p, false, p === state.page));
          }

          paginationBtns.appendChild(createBtn('â€º', state.page + 1, state.page === totalPages));
          paginationBtns.appendChild(createBtn('Â»', totalPages, state.page === totalPages));
        }
      }

    } catch (err) {
      console.error('[AUDIT LOAD ERROR]', err);
      if (errorState) {
        errorState.style.display = 'block';
        const msgEl = document.getElementById('auditErrorMsg');
        if (msgEl) msgEl.textContent = err.message || 'Failed to load audit logs from server.';
      }
    }
  };

  // Detail Modal Handler
  const detailModal = document.getElementById('auditDetailModal');
  const openDetailModal = (item) => {
    if (!detailModal) return;
    document.getElementById('modalAuditSeq').textContent = item.seq !== null && item.seq !== undefined ? `#${item.seq}` : 'Unchained';
    document.getElementById('modalAuditEventId').textContent = item.eventId || '-';
    document.getElementById('modalAuditTime').textContent = new Date(item.timestamp).toLocaleString();
    document.getElementById('modalAuditUser').textContent = item.userName || 'System';
    document.getElementById('modalAuditRole').innerHTML = EG.utils.roleBadgeHtml(item.role);
    document.getElementById('modalAuditAction').innerHTML = `<span class="badge-action badge-action-${escapeHtml(item.action)}">${escapeHtml(item.action)}</span>`;
    document.getElementById('modalAuditEvidenceId').textContent = item.evidenceId || '-';
    document.getElementById('modalAuditCaseId').textContent = item.caseId || '-';
    document.getElementById('modalAuditDesc').textContent = item.description || '-';

    const modalLabelIp = document.getElementById('modalLabelIp');
    const modalAuditIp = document.getElementById('modalAuditIp');
    if (isAdmin) {
      if (modalLabelIp) modalLabelIp.style.display = 'block';
      if (modalAuditIp) {
        modalAuditIp.style.display = 'block';
        modalAuditIp.textContent = item.ipAddress || '-';
      }
    } else {
      if (modalLabelIp) modalLabelIp.style.display = 'none';
      if (modalAuditIp) modalAuditIp.style.display = 'none';
    }

    detailModal.classList.add('active');
  };

  const closeDetailModal = () => {
    if (detailModal) detailModal.classList.remove('active');
  };

  const btnCloseModal = document.getElementById('btnCloseAuditModal');
  const btnCloseModal2 = document.getElementById('btnCloseAuditModalBtn');
  if (btnCloseModal) btnCloseModal.onclick = closeDetailModal;
  if (btnCloseModal2) btnCloseModal2.onclick = closeDetailModal;
  if (detailModal) {
    detailModal.onclick = (e) => {
      if (e.target === detailModal) closeDetailModal();
    };
  }

  // ADMIN Chain Validation Action
  const btnValidateAudit = document.getElementById('btnValidateAudit');
  const validationResultCard = document.getElementById('auditValidationResultCard');
  const resultHeadline = document.getElementById('auditResultHeadline');
  const resultDetails = document.getElementById('auditResultDetails');
  const headHashWrap = document.getElementById('auditHeadHashWrap');
  const headHashEl = document.getElementById('auditHeadHash');
  const btnCopyHash = document.getElementById('btnCopyAuditHeadHash');

  if (btnValidateAudit && isAdmin) {
    btnValidateAudit.onclick = async () => {
      btnValidateAudit.disabled = true;
      btnValidateAudit.textContent = 'ðŸ›¡ Validating Chain...';
      try {
        const valRes = await EG.api.post('/api/audit/validate', {});
        if (validationResultCard) validationResultCard.style.display = 'block';

        if (valRes.valid) {
          brokenSeq = null;
          if (validationResultCard) validationResultCard.style.borderLeftColor = 'var(--status-verified)';
          if (resultHeadline) resultHeadline.innerHTML = '<span style="color:var(--status-verified);">ðŸ›¡ AUDIT CHAIN: VALID</span>';
          if (resultDetails) {
            resultDetails.innerHTML = `
              <div>Cryptographic hash-chain is completely intact. <strong>${valRes.entriesChecked}</strong> sequential records validated.</div>
              <div style="font-size: 0.8rem; margin-top: 2px;">Validated on: ${new Date(valRes.validatedAt).toLocaleString()}</div>
            `;
          }
          if (headHashWrap && valRes.head) {
            headHashWrap.style.display = 'block';
            if (headHashEl) headHashEl.textContent = valRes.head.entryHash;
          }
          EG.utils.toast('Audit chain is VALID!', 'success');
        } else {
          brokenSeq = valRes.firstBrokenSeq;
          if (validationResultCard) validationResultCard.style.borderLeftColor = 'var(--status-tampered)';
          if (resultHeadline) resultHeadline.innerHTML = '<span style="color:var(--status-tampered);">âš ï¸ AUDIT CHAIN: INTEGRITY BREACH DETECTED</span>';
          const issueMsg = valRes.issues && valRes.issues.length ? `${valRes.issues[0].check}: expected "${escapeHtml(valRes.issues[0].expected)}", got "${escapeHtml(valRes.issues[0].actual)}"` : 'Hash mismatch';
          if (resultDetails) {
            resultDetails.innerHTML = `
              <div style="color:var(--status-tampered); font-weight:bold;">First broken entry sequence: #${valRes.firstBrokenSeq || 'unknown'}</div>
              <div>${escapeHtml(issueMsg)}</div>
              <div style="font-size: 0.8rem; margin-top: 2px;">Validated on: ${new Date(valRes.validatedAt).toLocaleString()}</div>
            `;
          }
          if (headHashWrap) headHashWrap.style.display = 'none';
          EG.utils.toast('Audit chain is TAMPERED / INVALID!', 'error');
        }

        // Reload logs to apply broken row highlights
        loadAuditLogs();
      } catch (err) {
        console.error('[AUDIT VALIDATE ERR]', err);
        EG.utils.toast(err.message || 'Validation failed', 'error');
      } finally {
        btnValidateAudit.disabled = false;
        btnValidateAudit.textContent = 'ðŸ›¡ Validate Audit Chain';
      }
    };
  }

  if (btnCopyHash && headHashEl) {
    btnCopyHash.onclick = () => {
      navigator.clipboard.writeText(headHashEl.textContent.trim()).then(() => {
        EG.utils.toast('Head hash copied to clipboard!', 'info');
      });
    };
  }

  // Filter event listeners with 300ms debounce
  let debounceTimeout = null;
  const onFilterChange = (resetPage = true) => {
    if (resetPage) state.page = 1;
    state.q = searchInput ? searchInput.value.trim() : '';
    state.action = actionSelect ? actionSelect.value : '';
    state.user = userSelect ? userSelect.value : '';
    state.evidenceId = evidenceInput ? evidenceInput.value.trim() : '';
    state.dateFrom = dateFromInput ? dateFromInput.value : '';
    state.dateTo = dateToInput ? dateToInput.value : '';
    state.sortBy = sortBySelect ? sortBySelect.value : 'timestamp';
    state.sortOrder = sortOrderSelect ? sortOrderSelect.value : 'desc';
    state.limit = pageSizeSelect ? parseInt(pageSizeSelect.value, 10) || 25 : 25;

    syncUrl();
    loadAuditLogs();
  };

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => onFilterChange(true), 300);
    });
  }

  if (evidenceInput) {
    evidenceInput.addEventListener('input', () => {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => onFilterChange(true), 300);
    });
  }

  if (actionSelect) actionSelect.addEventListener('change', () => onFilterChange(true));
  if (userSelect) userSelect.addEventListener('change', () => onFilterChange(true));
  if (dateFromInput) dateFromInput.addEventListener('change', () => onFilterChange(true));
  if (dateToInput) dateToInput.addEventListener('change', () => onFilterChange(true));
  if (sortBySelect) sortBySelect.addEventListener('change', () => onFilterChange(true));
  if (sortOrderSelect) sortOrderSelect.addEventListener('change', () => onFilterChange(true));
  if (pageSizeSelect) pageSizeSelect.addEventListener('change', () => onFilterChange(true));

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (actionSelect) actionSelect.value = '';
      if (userSelect) userSelect.value = '';
      if (evidenceInput) evidenceInput.value = '';
      if (dateFromInput) dateFromInput.value = '';
      if (dateToInput) dateToInput.value = '';
      if (sortBySelect) sortBySelect.value = 'timestamp';
      if (sortOrderSelect) sortOrderSelect.value = 'desc';
      if (pageSizeSelect) pageSizeSelect.value = '25';
      onFilterChange(true);
    });
  }

  const btnRetry = document.getElementById('btnRetryAudit');
  if (btnRetry) btnRetry.onclick = () => loadAuditLogs();

  // Initial load
  loadFilters();
  loadAuditLogs();

  // Clock in header
  const updateClock = () => {
    const dashClock = document.getElementById('dashClock');
    const liveClock = document.getElementById('liveClock');
    const nowStr = new Date().toLocaleString();
    if (dashClock) dashClock.textContent = nowStr;
    if (liveClock) liveClock.textContent = nowStr;
  };
  setInterval(updateClock, 1000);
  updateClock();
}

function initAbout() {
  // Static page, nothing special to init
}

// ========================
// ROUTER
// ========================
document.addEventListener('DOMContentLoaded', () => {
  // â”€â”€ Sidebar / nav setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  EG.utils.initSidebar();

  // Populate sidebar user info
  const user = EG.auth.getUser();
  const nameEl = document.getElementById('sidebarUserName');
  if (nameEl && user) nameEl.textContent = user.name;
  const roleEl = document.getElementById('sidebarUserRole');
  if (roleEl && user) roleEl.textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);

  // â”€â”€ Active nav link â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.sidebar-nav a, .nav-links a').forEach(a => {
    const href = (a.getAttribute('href') || '').split('/').pop();
    if (href === currentPage) a.classList.add('active');
  });

  // â”€â”€ Logout button (sidebar + any .logout-btn) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  document.querySelectorAll('#logoutBtn, .logout-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await EG.api.post('/api/auth/logout'); } catch (_) {}
      EG.auth.clearAuth();
      window.location.href = 'login.html';
    });
  });

  // â”€â”€ Hamburger menu (landing/about page navbar) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('navLinks');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));
  }

  // â”€â”€ Hide role-gated sidebar links â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (user) {
    if (!EG.auth.isAdmin())        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    if (!EG.auth.canViewAudit())   document.querySelectorAll('.audit-only').forEach(el => el.style.display = 'none');
    if (!EG.auth.isInvestigator()) document.querySelectorAll('.investigator-only').forEach(el => el.style.display = 'none');
    if (!EG.auth.canManageUsers()) document.querySelectorAll('.users-only').forEach(el => el.style.display = 'none');
  }

  // ── Page router ─────────────────────────────────────────────────────────────
  if      (currentPage === 'login.html')            initLogin();
  else if (currentPage === 'register.html')         initRegister();
  else if (currentPage === 'dashboard.html')        initDashboard();
  else if (currentPage === 'upload.html')           initUpload();
  else if (currentPage === 'records.html')          initRecords();
  else if (currentPage === 'evidence-details.html') initEvidenceDetails();
  else if (currentPage === 'verify.html')           initVerify();
  else if (currentPage === 'blockchain.html')       initBlockchain();
  else if (currentPage === 'audit.html')            initAudit();
  else if (currentPage === 'custody.html')          initCustody();
  else if (currentPage === 'users.html')            initUsers();
  else if (currentPage === 'index.html' || currentPage === '') initIndex();
});

// ========================
// INDEX / LANDING PAGE
// ========================
async function initIndex() {
  const btnDashboard = document.getElementById('btnHeroDashboard');
  const btnUpload = document.getElementById('btnHeroUpload');
  const btnVerify = document.getElementById('btnHeroVerify');
  const uploadExplanation = document.getElementById('uploadExplanation');

  try {
    const user = await EG.auth.getCurrentUser();
    if (user) {
      if (btnDashboard) btnDashboard.href = 'dashboard.html';
      if (btnVerify) btnVerify.href = 'verify.html';
      
      if (user.role === 'VIEWER') {
        if (btnUpload) {
          btnUpload.removeAttribute('href');
          btnUpload.classList.add('disabled');
          btnUpload.setAttribute('aria-disabled', 'true');
          btnUpload.style.opacity = '0.55';
          btnUpload.style.cursor = 'not-allowed';
          btnUpload.title = 'Upload Evidence requires Investigator or Admin role';
        }
        if (uploadExplanation) {
          uploadExplanation.style.display = 'block';
          uploadExplanation.textContent = 'Upload Evidence requires Investigator or Admin role (Current: Viewer)';
        }
      } else {
        if (btnUpload) btnUpload.href = 'upload.html';
      }
    } else {
      if (btnDashboard) btnDashboard.href = 'login.html?next=dashboard.html';
      if (btnUpload) btnUpload.href = 'login.html?next=upload.html';
      if (btnVerify) btnVerify.href = 'verify.html';
    }
  } catch (err) {
    if (btnDashboard) btnDashboard.href = 'login.html?next=dashboard.html';
    if (btnUpload) btnUpload.href = 'login.html?next=upload.html';
    if (btnVerify) btnVerify.href = 'verify.html';
  }

  // Live Genuine Counts
  try {
    const res = await fetch('/api/public/stats', { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      if (data && data.stats) {
        const evCountEl = document.getElementById('statEvidenceCount');
        const verCountEl = document.getElementById('statVerifiedCount');
        const blkCountEl = document.getElementById('statBlockCount');
        if (evCountEl) evCountEl.textContent = data.stats.evidenceCount ?? 0;
        if (verCountEl) verCountEl.textContent = data.stats.verifiedCount ?? 0;
        if (blkCountEl) blkCountEl.textContent = data.stats.blockCount ?? 0;
      }
    }
  } catch (_) {}
}

// ──────────────────────────────────────────────────────────────────────────
// SPRINT 12: CHAIN OF CUSTODY HUB PAGE (custody.html)
// ──────────────────────────────────────────────────────────────────────────
async function initCustody() {
  EG.auth.requireAuth('login.html');
  const user = EG.auth.getUser();

  if (user && user.role === 'VIEWER') {
    EG.utils.toast('Access Denied: Chain of Custody ledger is restricted to Investigators and Admins.', 'error');
    window.location.href = 'dashboard.html';
    return;
  }

  const hubCountHeld = document.getElementById('hubCountHeld');
  const hubCountIncoming = document.getElementById('hubCountIncoming');
  const hubCountOutgoing = document.getElementById('hubCountOutgoing');
  const pillHeld = document.getElementById('pillHeld');
  const pillIncoming = document.getElementById('pillIncoming');
  const pillOutgoing = document.getElementById('pillOutgoing');
  const hubIncomingAlert = document.getElementById('hubIncomingAlert');
  const cardPendingIncoming = document.getElementById('cardPendingIncoming');

  const tabBtnHeld = document.getElementById('tabBtnHeld');
  const tabBtnIncoming = document.getElementById('tabBtnIncoming');
  const tabBtnOutgoing = document.getElementById('tabBtnOutgoing');
  const tabHeld = document.getElementById('tabHeld');
  const tabIncoming = document.getElementById('tabIncoming');
  const tabOutgoing = document.getElementById('tabOutgoing');

  const tbodyHeld = document.getElementById('tbodyHeld');
  const tbodyIncoming = document.getElementById('tbodyIncoming');
  const tbodyOutgoing = document.getElementById('tbodyOutgoing');
  const emptyHeldMsg = document.getElementById('emptyHeldMsg');
  const emptyIncomingMsg = document.getElementById('emptyIncomingMsg');
  const emptyOutgoingMsg = document.getElementById('emptyOutgoingMsg');

  // Tab Switching
  const switchTab = (tabName) => {
    [tabBtnHeld, tabBtnIncoming, tabBtnOutgoing].forEach(btn => btn?.classList.remove('active'));
    [tabHeld, tabIncoming, tabOutgoing].forEach(panel => {
      if (panel) panel.style.display = 'none';
    });

    if (tabName === 'incoming') {
      tabBtnIncoming?.classList.add('active');
      if (tabIncoming) tabIncoming.style.display = 'block';
    } else if (tabName === 'outgoing') {
      tabBtnOutgoing?.classList.add('active');
      if (tabOutgoing) tabOutgoing.style.display = 'block';
    } else {
      tabBtnHeld?.classList.add('active');
      if (tabHeld) tabHeld.style.display = 'block';
    }
  };

  tabBtnHeld?.addEventListener('click', () => switchTab('held'));
  tabBtnIncoming?.addEventListener('click', () => switchTab('incoming'));
  tabBtnOutgoing?.addEventListener('click', () => switchTab('outgoing'));
  document.getElementById('btnGoToIncomingTab')?.addEventListener('click', () => switchTab('incoming'));
  document.getElementById('btnRefreshCustodyHub')?.addEventListener('click', () => loadHubData());

  let activeRejectCustodyId = null;
  const hubRejectModal = document.getElementById('hubRejectModal');
  const closeHubRejectModalBtn = document.getElementById('closeHubRejectModalBtn');
  const cancelHubRejectBtn = document.getElementById('cancelHubRejectBtn');
  const hubRejectForm = document.getElementById('hubRejectForm');
  const hubRejectReasonInput = document.getElementById('hubRejectReasonInput');

  const openRejectModal = (custodyId) => {
    activeRejectCustodyId = custodyId;
    if (hubRejectReasonInput) hubRejectReasonInput.value = '';
    hubRejectModal?.classList.add('active');
  };

  const closeRejectModal = () => {
    activeRejectCustodyId = null;
    hubRejectModal?.classList.remove('active');
  };

  closeHubRejectModalBtn?.addEventListener('click', closeRejectModal);
  cancelHubRejectBtn?.addEventListener('click', closeRejectModal);

  hubRejectForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = hubRejectReasonInput?.value?.trim();
    if (!reason || reason.length < 5) {
      EG.utils.toast('Please provide a reason of at least 5 characters.', 'error');
      return;
    }
    try {
      await EG.api.post(`/api/custody/${encodeURIComponent(activeRejectCustodyId)}/reject`, { reason });
      EG.utils.toast('Custody handover declined.', 'info');
      closeRejectModal();
      loadHubData();
    } catch (err) {
      EG.utils.toast(err.message || 'Failed to reject transfer', 'error');
    }
  });

  const loadHubData = async () => {
    try {
      const res = await EG.api.get('/api/custody/mine');
      if (!res || !res.success) return;

      const itemsInCustody = res.itemsInCustody || [];
      const pendingIncoming = res.pendingIncoming || [];
      const pendingOutgoing = res.pendingOutgoing || [];

      // Update counters
      const heldCount = itemsInCustody.length;
      const inCount = pendingIncoming.length;
      const outCount = pendingOutgoing.length;

      if (hubCountHeld) hubCountHeld.textContent = heldCount;
      if (hubCountIncoming) hubCountIncoming.textContent = inCount;
      if (hubCountOutgoing) hubCountOutgoing.textContent = outCount;
      if (pillHeld) pillHeld.textContent = heldCount;
      if (pillIncoming) pillIncoming.textContent = inCount;
      if (pillOutgoing) pillOutgoing.textContent = outCount;

      // Pulse incoming card if action required
      if (inCount > 0) {
        if (hubIncomingAlert) hubIncomingAlert.style.display = 'flex';
        cardPendingIncoming?.classList.add('pulse-glow');
      } else {
        if (hubIncomingAlert) hubIncomingAlert.style.display = 'none';
        cardPendingIncoming?.classList.remove('pulse-glow');
      }

      // 1. Render Held Table
      if (itemsInCustody.length === 0) {
        if (tbodyHeld) tbodyHeld.innerHTML = '';
        if (emptyHeldMsg) emptyHeldMsg.style.display = 'block';
      } else {
        if (emptyHeldMsg) emptyHeldMsg.style.display = 'none';
        if (tbodyHeld) {
          tbodyHeld.innerHTML = itemsInCustody.map(item => {
            const ev = item.evidence || {};
            const evId = escapeHtml(ev.evidenceId || 'EV-????');
            const caseId = escapeHtml(ev.caseId || 'EG-????');
            const name = escapeHtml(ev.name || 'Untitled');
            const status = escapeHtml(item.status || 'IN_CUSTODY');
            const total = item.totalEvents || 1;
            const lastType = item.lastEvent ? escapeHtml(item.lastEvent.type) : 'COLLECTED';
            const lastTime = item.lastEvent ? EG.utils.formatDate(item.lastEvent.occurredAt) : 'N/A';

            return `
              <tr>
                <td style="font-family: monospace; font-weight: 700; color: var(--accent-cyan);">${evId}</td>
                <td style="font-family: monospace;">${caseId}</td>
                <td style="font-weight: 600;">${name}</td>
                <td><span class="custody-badge-incustody">✔ ${status}</span></td>
                <td><span class="badge" style="background:rgba(0,212,255,0.15); color:var(--accent-cyan);">${total} events</span></td>
                <td style="font-size: 0.85rem; color: var(--text-muted);">${lastType} (${lastTime})</td>
                <td>
                  <a href="evidence-details.html?id=${encodeURIComponent(ev.evidenceId)}" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.82rem;">View & Transfer →</a>
                </td>
              </tr>
            `;
          }).join('');
        }
      }

      // 2. Render Incoming Transfers Table
      if (pendingIncoming.length === 0) {
        if (tbodyIncoming) tbodyIncoming.innerHTML = '';
        if (emptyIncomingMsg) emptyIncomingMsg.style.display = 'block';
      } else {
        if (emptyIncomingMsg) emptyIncomingMsg.style.display = 'none';
        if (tbodyIncoming) {
          tbodyIncoming.innerHTML = pendingIncoming.map(item => {
            const ev = item.evidence || {};
            const tr = item.transfer || {};
            const evId = escapeHtml(ev.evidenceId || tr.evidenceId || 'EV-????');
            const fromUser = escapeHtml(tr.fromUserName || 'Officer');
            const reason = escapeHtml(tr.reason || '');

            let expireText = '72h limit';
            if (tr.expiresAt) {
              const diffMs = new Date(tr.expiresAt) - new Date();
              const h = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
              const m = Math.max(0, Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)));
              expireText = `${h}h ${m}m remaining`;
            }

            return `
              <tr>
                <td style="font-family: monospace; font-weight: 700; color: var(--accent-cyan);">
                  <a href="evidence-details.html?id=${encodeURIComponent(evId)}" style="color:var(--accent-cyan);">${evId}</a>
                </td>
                <td><strong>${fromUser}</strong></td>
                <td style="font-size: 0.9rem;">${reason}</td>
                <td style="color: #ffb74d; font-size: 0.85rem; font-weight: 600;">⏳ ${expireText}</td>
                <td>
                  <div style="display: flex; gap: 6px;">
                    <button type="button" class="btn btn-primary btn-accept-hub" data-id="${tr.custodyId}" data-ev="${evId}" style="padding: 4px 10px; font-size: 0.82rem; background: #00c48c;">Accept</button>
                    <button type="button" class="btn btn-secondary btn-reject-hub" data-id="${tr.custodyId}" style="padding: 4px 10px; font-size: 0.82rem; border-color: #ff4c4c; color: #ff4c4c;">Decline</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('');

          // Wire Accept and Decline buttons
          tbodyIncoming.querySelectorAll('.btn-accept-hub').forEach(btn => {
            btn.onclick = async () => {
              const cId = btn.getAttribute('data-id');
              const ev = btn.getAttribute('data-ev');
              if (!confirm(`Accept legal custody of evidence ${ev}?`)) return;
              btn.disabled = true;
              try {
                await EG.api.post(`/api/custody/${encodeURIComponent(cId)}/accept`, {
                  reason: 'Custody transfer accepted and physical custody assumed'
                });
                EG.utils.toast('Custody successfully assumed!', 'success');
                loadHubData();
              } catch (err) {
                EG.utils.toast(err.message || 'Failed to accept', 'error');
                btn.disabled = false;
              }
            };
          });

          tbodyIncoming.querySelectorAll('.btn-reject-hub').forEach(btn => {
            btn.onclick = () => {
              const cId = btn.getAttribute('data-id');
              openRejectModal(cId);
            };
          });
        }
      }

      // 3. Render Outgoing Transfers Table
      if (pendingOutgoing.length === 0) {
        if (tbodyOutgoing) tbodyOutgoing.innerHTML = '';
        if (emptyOutgoingMsg) emptyOutgoingMsg.style.display = 'block';
      } else {
        if (emptyOutgoingMsg) emptyOutgoingMsg.style.display = 'none';
        if (tbodyOutgoing) {
          tbodyOutgoing.innerHTML = pendingOutgoing.map(item => {
            const ev = item.evidence || {};
            const tr = item.transfer || {};
            const evId = escapeHtml(ev.evidenceId || tr.evidenceId || 'EV-????');
            const toUser = escapeHtml(tr.toUserName || 'Officer');
            const reason = escapeHtml(tr.reason || '');

            let expireText = '72h limit';
            if (tr.expiresAt) {
              const diffMs = new Date(tr.expiresAt) - new Date();
              const h = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
              const m = Math.max(0, Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)));
              expireText = `${h}h ${m}m remaining`;
            }

            return `
              <tr>
                <td style="font-family: monospace; font-weight: 700; color: var(--accent-cyan);">
                  <a href="evidence-details.html?id=${encodeURIComponent(evId)}" style="color:var(--accent-cyan);">${evId}</a>
                </td>
                <td><strong>${toUser}</strong></td>
                <td style="font-size: 0.9rem;">${reason}</td>
                <td style="color: var(--text-muted); font-size: 0.85rem;">⏳ ${expireText}</td>
                <td>
                  <button type="button" class="btn btn-secondary btn-cancel-hub" data-id="${tr.custodyId}" style="padding: 4px 10px; font-size: 0.82rem;">Cancel Handover</button>
                </td>
              </tr>
            `;
          }).join('');

          tbodyOutgoing.querySelectorAll('.btn-cancel-hub').forEach(btn => {
            btn.onclick = async () => {
              const cId = btn.getAttribute('data-id');
              if (!confirm('Cancel this pending custody transfer?')) return;
              btn.disabled = true;
              try {
                await EG.api.post(`/api/custody/${encodeURIComponent(cId)}/cancel`, {
                  reason: 'Custody transfer cancelled by initiator'
                });
                EG.utils.toast('Custody transfer cancelled', 'info');
                loadHubData();
              } catch (err) {
                EG.utils.toast(err.message || 'Failed to cancel', 'error');
                btn.disabled = false;
              }
            };
          });
        }
      }

    } catch (err) {
      console.error('[Custody Hub Error]', err);
      EG.utils.toast('Failed to load custody records', 'error');
    }
  };

  loadHubData();
}