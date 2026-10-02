const fs = require('fs');
const path = require('path');

const publicDir = 'c:/Users/madhu/.gemini/antigravity/scratch/EvidenceGuard/public';

const layout = (title) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - EvidenceGuard</title>
  <link rel="stylesheet" href="style.css">
  <script src="script.js" defer></script>
  <style>
    :root { --muted: #aaa; --text: #fff; --red: #ff4444; --bg: #0a0e1a; --card-bg: rgba(255,255,255,0.05); }
    body { background-color: var(--bg); color: var(--text); margin: 0; font-family: sans-serif; display: flex; height: 100vh; overflow: hidden; }
    .app-wrapper { display: flex; width: 100%; height: 100%; }
    
    /* Sidebar */
    .sidebar { width: 260px; background: rgba(0,0,0,0.3); border-right: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; }
    .sidebar-brand { padding: 1.5rem; font-size: 1.25rem; font-weight: bold; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .sidebar-nav { flex: 1; padding: 1rem 0; overflow-y: auto; }
    .sidebar-nav a { display: flex; align-items: center; padding: 0.75rem 1.5rem; color: var(--muted); text-decoration: none; transition: all 0.2s; gap: 12px; }
    .sidebar-nav a:hover, .sidebar-nav a.active { color: white; background: rgba(255,255,255,0.05); border-left: 4px solid #0066cc; }
    .sidebar-footer { padding: 1.5rem; border-top: 1px solid rgba(255,255,255,0.1); }
    
    /* Main Content */
    .main-content { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }
    .dash-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 2rem; background: rgba(0,0,0,0.2); border-bottom: 1px solid rgba(255,255,255,0.1); }
    .dash-header h1 { margin: 0; font-size: 1.25rem; }
    .menu-toggle { display: none; background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer; }
    .d-flex { display: flex; }
    .align-center { align-items: center; }
    .gap-2 { gap: 1rem; }
    .badge-online { background: rgba(0,255,0,0.2); color: #00ff00; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; border: 1px solid rgba(0,255,0,0.3); }
    
    .content-area { padding: 2rem; display: flex; justify-content: center; align-items: center; height: 100%; }
  </style>
</head>
<body>
  <div class="app-wrapper">
    <aside class='sidebar' id='sidebar'>
      <div class='sidebar-brand'>
        <div class='logo-icon'>🔐</div>
        EvidenceGuard
      </div>
      <nav class='sidebar-nav'>
        <a href='dashboard.html'><span class='nav-icon'>📊</span> Dashboard</a>
        <a href='upload.html'><span class='nav-icon'>⬆</span> Upload Evidence</a>
        <a href='records.html'><span class='nav-icon'>🗂</span> Evidence Records</a>
        <a href='verify.html'><span class='nav-icon'>✅</span> Verify Evidence</a>
        <a href='blockchain.html'><span class='nav-icon'>⛓</span> Blockchain</a>
        <a href='audit.html' class='${title === 'Audit Trail' ? 'active' : ''}'><span class='nav-icon'>📋</span> Audit Trail</a>
        <a href='users.html' class='${title === 'Users' ? 'active' : ''}'><span class='nav-icon'>👥</span> Users</a>
        <a href='about.html'><span class='nav-icon'>ℹ️</span> About</a>
      </nav>
      <div class='sidebar-footer'>
        <div style='font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem;padding:0 0.25rem'>
          <div id='sidebarUserName' style='font-weight:600;color:var(--text)'>Admin User</div>
          <div id='sidebarUserRole' style='font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;'>Admin</div>
        </div>
        <a href='login.html' id='logoutBtn' style='color:var(--red);display:flex;align-items:center;gap:8px;font-size:0.875rem;text-decoration:none;'>🚪 Logout</a>
      </div>
    </aside>

    <main class="main-content">
      <div class='dash-header'>
        <div style='display:flex;align-items:center;gap:12px;'>
          <button class='menu-toggle' id='menuToggle'>☰</button>
          <h1>${title}</h1>
        </div>
        <div class='header-right d-flex align-center gap-2'>
          <span class='badge-online'>System Online</span>
          <span id='dashClock' style='font-size:0.82rem;color:var(--muted);'></span>
        </div>
      </div>

      <div class="content-area">
        <h2>Coming in a later sprint</h2>
      </div>
    </main>
  </div>
</body>
</html>`;

const pages = [
  { file: 'login.html', title: 'Login' },
  { file: 'register.html', title: 'Register' },
  { file: 'evidence-details.html', title: 'Evidence Details' },
  { file: 'audit.html', title: 'Audit Trail' },
  { file: 'users.html', title: 'Users' }
];

pages.forEach(p => {
  fs.writeFileSync(path.join(publicDir, p.file), layout(p.title));
});

console.log('Placeholders created successfully.');
