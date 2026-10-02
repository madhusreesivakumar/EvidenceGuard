const fs = require('fs');
const path = require('path');
const publicDir = 'c:/Users/madhu/.gemini/antigravity/scratch/EvidenceGuard/public';

// 1. Move old script.js page logic to page-logic.js
const oldScript = fs.readFileSync(path.join(publicDir, 'script.js'), 'utf8');
fs.writeFileSync(path.join(publicDir, 'page-logic.js'), oldScript);

// 2. Create the new script.js with only shared helpers
const newScript = `
'use strict';

const EG = {
  api: {
    _fetch: async (method, endpoint, body, isFormData = false) => {
      const token = localStorage.getItem('eg_token');
      const headers = {};
      if (token) headers['Authorization'] = \`Bearer \${token}\`;
      if (!isFormData && body) headers['Content-Type'] = 'application/json';

      const options = { method, headers };
      if (body) options.body = isFormData ? body : JSON.stringify(body);

      try {
        const response = await fetch(endpoint, options);
        const json = await response.json();
        if (!response.ok) {
          if (response.status === 401) { localStorage.removeItem('eg_token'); window.location.href = 'login.html'; }
          throw new Error(json.message || 'Request failed.');
        }
        return { ...json, ...(json.data && typeof json.data === 'object' ? json.data : {}) };
      } catch (err) {
        console.error('[API]', err.message);
        throw err;
      }
    },
    get: async (url) => EG.api._fetch('GET', url),
    post: async (url, data) => EG.api._fetch('POST', url, data),
    patch: async (url, data) => EG.api._fetch('PATCH', url, data),
    del: async (url) => EG.api._fetch('DELETE', url)
  },
  utils: {
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
    showToast: (type = 'success', msg) => {
      let container = document.querySelector('.toast-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
      }
      const toast = document.createElement('div');
      toast.className = \`toast\`;
      toast.style.borderLeft = \`4px solid \${type === 'error' ? 'var(--status-tampered)' : type === 'warning' ? 'var(--status-pending)' : 'var(--status-verified)'}\`;
      toast.textContent = msg;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    },
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
  }
};

window.EG = EG;

// Common shell logic
document.addEventListener('DOMContentLoaded', () => {
  EG.utils.highlightNav();

  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  if (hamburger && sidebar) {
    hamburger.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
    });
  }

  const liveClock = document.getElementById('liveClock');
  if (liveClock) {
    setInterval(() => {
      liveClock.textContent = new Date().toLocaleString();
    }, 1000);
  }
});
`;
fs.writeFileSync(path.join(publicDir, 'script.js'), newScript);

// 3. Update all HTML files
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
const getTitle = (file) => file.replace('.html', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());

files.forEach(file => {
  let content = fs.readFileSync(path.join(publicDir, file), 'utf8');
  
  // Try to extract existing main content
  let mainContent = '';
  if (content.includes('<main class="main-content">')) {
    mainContent = content.split('<main class="main-content">')[1].split('</main>')[0];
  } else if (content.includes('<div class="content-area">')) {
    mainContent = content.split('<div class="content-area">')[1].split('</div>\n    </main>')[0];
  } else if (content.includes('<main style=')) {
    mainContent = content.split(/<main[^>]*>/)[1].split('</main>')[0];
  } else if (content.includes('<div class="auth-page">')) {
    mainContent = content.split('<div class="auth-page">')[1].split('</body>')[0];
  } else {
    // Fallback: just take body contents minus scripts
    mainContent = content.split('<body>')[1].split('</body>')[0];
  }

  // Create new structure
  const shell = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${getTitle(file)} - EvidenceGuard</title>
  <link rel="stylesheet" href="style.css">
  <script src="script.js" defer></script>
  <script src="page-logic.js" defer></script>
</head>
<body>
  <div class="app-container">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="logo-icon">🔐</div> EvidenceGuard
      </div>
      <nav class="sidebar-nav">
        <a href="dashboard.html" class="nav-item"><span class="nav-icon">📊</span> Dashboard</a>
        <a href="upload.html" class="nav-item"><span class="nav-icon">⬆</span> Upload Evidence</a>
        <a href="records.html" class="nav-item"><span class="nav-icon">🗂</span> Evidence Records</a>
        <a href="verify.html" class="nav-item"><span class="nav-icon">✅</span> Verify Evidence</a>
        <a href="blockchain.html" class="nav-item"><span class="nav-icon">⛓</span> Blockchain</a>
        <a href="audit.html" class="nav-item"><span class="nav-icon">📋</span> Audit Trail</a>
        <a href="users.html" class="nav-item"><span class="nav-icon">👥</span> Users</a>
        <a href="about.html" class="nav-item"><span class="nav-icon">ℹ️</span> About</a>
      </nav>
      <div class="sidebar-footer">
        <div id="sidebarUserName" style="font-weight:bold;">User</div>
        <div id="sidebarUserRole" style="font-size:0.8rem; color: var(--text-muted);">Role</div>
        <a href="login.html" id="logoutBtn" style="color:var(--status-tampered); display:block; margin-top:10px;">🚪 Logout</a>
      </div>
    </aside>

    <div class="main-wrapper">
      <header class="topbar">
        <div style="display:flex; align-items:center; gap:10px;">
          <button class="hamburger" id="hamburger">☰</button>
          <h1 id="pageTitle" style="font-size:1.2rem; margin:0;">${getTitle(file)}</h1>
        </div>
        <div class="topbar-right">
          <span class="live-clock" id="liveClock"></span>
          <div class="user-area">
            <span class="badge badge-verified">System Online</span>
          </div>
        </div>
      </header>

      <main class="main-content">
        ${mainContent}
      </main>

      <footer class="page-footer">
        &copy; 2026 EvidenceGuard
      </footer>
    </div>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(publicDir, file), shell);
});

console.log('Migration complete.');
