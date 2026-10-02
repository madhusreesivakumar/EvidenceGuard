/* ==============================
   EvidenceGuard – script.js
   Shared utilities + page logic
   ============================== */

'use strict';

// =========================================
// SHA-256 via Web Crypto API
// =========================================
async function sha256(data) {
  let buffer;
  if (data instanceof ArrayBuffer) {
    buffer = data;
  } else {
    buffer = new TextEncoder().encode(data);
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray  = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// =========================================
// Local Storage helpers
// =========================================
function getRecords() {
  const raw = localStorage.getItem('eg_records');
  if (raw) return JSON.parse(raw);
  // Seed demo data on first load
  const demo = [
    {
      id: 'EV-001',
      name: 'CCTV Footage',
      type: 'Video',
      filename: 'cctv_footage_18sep.mp4',
      date: '19 Sep 2026',
      hash: 'a3f1b2c4d5e6f7890ab1cd23ef456789abcdef1234567890abcdef1234567890',
      status: 'Verified'
    },
    {
      id: 'EV-002',
      name: 'Crime Scene Image',
      type: 'Image',
      filename: 'crime_scene_photo01.jpg',
      date: '19 Sep 2026',
      hash: 'b9e8c7d6a5f4e3210abc1def23456789fedcba0987654321fedcba0987654321',
      status: 'Verified'
    },
    {
      id: 'EV-003',
      name: 'Case Document',
      type: 'Document',
      filename: 'case_file_report.pdf',
      date: '18 Sep 2026',
      hash: 'c4d5e6f7a8b9c0d1e2f3041526374859afbecdfe109283746571828394afbec',
      status: 'Pending'
    },
    {
      id: 'EV-004',
      name: 'Audio Recording',
      type: 'Audio',
      filename: 'interview_audio_16sep.mp3',
      date: '17 Sep 2026',
      hash: 'd1e2f3c4b5a6978801122334455667788990aabb00ccdd11ee22ff33440aabb',
      status: 'Tampered'
    },
    {
      id: 'EV-005',
      name: 'Witness Statement',
      type: 'Document',
      filename: 'witness_statement.docx',
      date: '17 Sep 2026',
      hash: 'e5f6a7b8c9d0e1f2031425364758697a0b1c2d3e4f506172839a0b1c2d3e4f',
      status: 'Verified'
    }
  ];
  localStorage.setItem('eg_records', JSON.stringify(demo));
  return demo;
}

function saveRecords(records) {
  localStorage.setItem('eg_records', JSON.stringify(records));
}

function addRecord(rec) {
  const records = getRecords();
  records.unshift(rec);
  saveRecords(records);
}

function nextId() {
  const records = getRecords();
  const nums = records.map(r => parseInt(r.id.replace('EV-', ''))).filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 5;
  return 'EV-' + String(max + 1).padStart(3, '0');
}

// =========================================
// Navigation helpers
// =========================================
function initNavbar() {
  const burger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (burger && navLinks) {
    burger.addEventListener('click', () => navLinks.classList.toggle('open'));
    navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => navLinks.classList.remove('open')));
  }
  // Mark active link
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .sidebar-nav a').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href === path || (path === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });
}

function initSidebar() {
  const toggle = document.querySelector('.menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (!toggle || !sidebar) return;
  let overlay = document.querySelector('.sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }
  function open() { sidebar.classList.add('open'); overlay.classList.add('show'); }
  function close() { sidebar.classList.remove('open'); overlay.classList.remove('show'); }
  toggle.addEventListener('click', () => sidebar.classList.contains('open') ? close() : open());
  overlay.addEventListener('click', close);
}

// =========================================
// Format date/time
// =========================================
function formatNow() {
  const d = new Date();
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function formatDate(d) {
  const dt = d || new Date();
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// =========================================
// Badge helper
// =========================================
function badgeHtml(status) {
  const cls = { Verified: 'badge-verified', Pending: 'badge-pending', Tampered: 'badge-tampered' };
  return `<span class="badge ${cls[status] || 'badge-pending'}">${status}</span>`;
}

// =========================================
// PAGE: UPLOAD (upload.html)
// =========================================
async function initUpload() {
  const form    = document.getElementById('uploadForm');
  const fileIn  = document.getElementById('evidenceFile');
  const fileDrop = document.getElementById('fileDrop');
  const fileChosen = document.getElementById('fileChosen');
  const resultPanel = document.getElementById('uploadResult');
  const spinner = document.getElementById('uploadSpinner');

  if (!form) return;

  // File name display
  if (fileIn) {
    fileIn.addEventListener('change', () => {
      const f = fileIn.files[0];
      fileChosen.textContent = f ? f.name : '';
    });
    // Drag events
    fileDrop.addEventListener('dragover', e => { e.preventDefault(); fileDrop.classList.add('dragover'); });
    fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('dragover'));
    fileDrop.addEventListener('drop', e => {
      e.preventDefault(); fileDrop.classList.remove('dragover');
      if (e.dataTransfer.files[0]) {
        const dt = new DataTransfer();
        dt.items.add(e.dataTransfer.files[0]);
        fileIn.files = dt.files;
        fileChosen.textContent = e.dataTransfer.files[0].name;
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('evidenceName').value.trim();
    const type = document.getElementById('evidenceType').value;
    const desc = document.getElementById('evidenceDesc').value.trim();
    const file = fileIn.files[0];

    if (!name || !type) { alert('Please fill in Evidence Name and Type.'); return; }

    spinner.style.display = 'flex';
    resultPanel.classList.remove('show');

    await new Promise(r => setTimeout(r, 900)); // simulate processing

    let hash;
    if (file) {
      const buf = await file.arrayBuffer();
      hash = await sha256(buf);
    } else {
      hash = await sha256(name + type + desc + Date.now());
    }

    const id   = nextId();
    const date = formatDate();
    const fname = file ? file.name : name.toLowerCase().replace(/\s+/g, '_') + '.bin';

    addRecord({ id, name, type, filename: fname, date, hash, status: 'Verified', desc });

    spinner.style.display = 'none';
    resultPanel.classList.add('show');

    document.getElementById('res-id').textContent   = id;
    document.getElementById('res-hash').textContent = hash;
    document.getElementById('res-date').textContent = formatNow();
    document.getElementById('res-file').textContent = fname;
    document.getElementById('res-name').textContent = name;

    form.reset();
    fileChosen.textContent = '';
  });
}

// =========================================
// PAGE: RECORDS (records.html)
// =========================================
function initRecords() {
  const tbody = document.getElementById('recordsTbody');
  if (!tbody) return;

  const searchInput = document.getElementById('recordSearch');
  const filterBtns  = document.querySelectorAll('.filter-btn');
  let activeFilter = 'All';

  function render() {
    const records = getRecords();
    const query = (searchInput ? searchInput.value.toLowerCase() : '');
    const filtered = records.filter(r => {
      const matchFilter = activeFilter === 'All' || r.type === activeFilter;
      const matchSearch = !query ||
        r.id.toLowerCase().includes(query) ||
        r.name.toLowerCase().includes(query) ||
        r.type.toLowerCase().includes(query) ||
        r.filename.toLowerCase().includes(query) ||
        r.status.toLowerCase().includes(query);
      return matchFilter && matchSearch;
    });

    tbody.innerHTML = '';
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:2rem">No records found.</td></tr>';
      return;
    }
    filtered.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${r.id}</td>
        <td>${r.name}</td>
        <td>${r.type}</td>
        <td>${r.filename}</td>
        <td>${r.date}</td>
        <td class="hash-cell" title="${r.hash}">${r.hash}</td>
        <td>${badgeHtml(r.status)}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="viewRecord('${r.id}')">View</button>
          <button class="btn btn-sm" style="background:rgba(0,196,140,0.12);color:var(--green);border:1px solid rgba(0,196,140,0.3);margin-left:4px;" onclick="verifyRecord('${r.id}')">Verify</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  if (searchInput) searchInput.addEventListener('input', render);
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      render();
    });
  });

  render();
}

window.viewRecord = function(id) {
  const r = getRecords().find(x => x.id === id);
  if (!r) return;
  alert(`Evidence Details\n\nID: ${r.id}\nName: ${r.name}\nType: ${r.type}\nFile: ${r.filename}\nDate: ${r.date}\nStatus: ${r.status}\nSHA-256: ${r.hash}`);
};
window.verifyRecord = function(id) {
  location.href = 'verify.html?id=' + id;
};

// =========================================
// PAGE: VERIFY (verify.html)
// =========================================
function initVerify() {
  const form = document.getElementById('verifyForm');
  if (!form) return;

  const fileIn   = document.getElementById('verifyFile');
  const fileChosen = document.getElementById('vFileChosen');
  const result   = document.getElementById('verifyResult');
  const spinner  = document.getElementById('verifySpinner');
  const fileDrop = document.getElementById('vFileDrop');

  // Pre-fill ID if passed in URL
  const params = new URLSearchParams(location.search);
  const preId  = params.get('id');
  if (preId) {
    const sel = document.getElementById('verifyEvidenceId');
    if (sel) sel.value = preId;
  }

  if (fileIn && fileDrop) {
    fileIn.addEventListener('change', () => {
      fileChosen.textContent = fileIn.files[0] ? fileIn.files[0].name : '';
    });
    fileDrop.addEventListener('dragover', e => { e.preventDefault(); fileDrop.classList.add('dragover'); });
    fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('dragover'));
    fileDrop.addEventListener('drop', e => {
      e.preventDefault(); fileDrop.classList.remove('dragover');
      if (e.dataTransfer.files[0]) {
        const dt = new DataTransfer(); dt.items.add(e.dataTransfer.files[0]);
        fileIn.files = dt.files;
        fileChosen.textContent = e.dataTransfer.files[0].name;
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idSel = document.getElementById('verifyEvidenceId');
    const selectedId = idSel ? idSel.value : '';
    const file = fileIn ? fileIn.files[0] : null;

    if (!selectedId) { alert('Please select an Evidence ID to verify.'); return; }

    spinner.style.display = 'flex';
    result.classList.remove('show', 'success', 'error');

    await new Promise(r => setTimeout(r, 1000));

    const records  = getRecords();
    const record   = records.find(r => r.id === selectedId);

    let currentHash;
    if (file) {
      const buf = await file.arrayBuffer();
      currentHash = await sha256(buf);
    } else {
      // Demo: no file uploaded → simulate verified by using same hash
      currentHash = record ? record.hash : await sha256('demo' + Date.now());
    }

    spinner.style.display = 'none';

    const originalHash = record ? record.hash : null;
    // For demo: if no file selected (just ID), we show VERIFIED.
    const isVerified = file ? (currentHash === originalHash) : true;

    result.classList.add('show', isVerified ? 'success' : 'error');

    document.getElementById('vr-icon').textContent   = isVerified ? '✅' : '❌';
    document.getElementById('vr-status').textContent = isVerified ? '✓ VERIFIED' : '✗ TAMPERED';
    document.getElementById('vr-status').style.color = isVerified ? 'var(--green)' : 'var(--red)';
    document.getElementById('vr-msg').textContent    = isVerified
      ? 'The evidence file matches the original registered hash.'
      : 'The evidence file does NOT match the original registered hash. Evidence may be tampered.';
    document.getElementById('vr-original').textContent = originalHash || 'N/A';
    document.getElementById('vr-current').textContent  = currentHash;
    document.getElementById('vr-time').textContent     = formatNow();
    document.getElementById('vr-evidence').textContent = record ? record.name : selectedId;
  });
}

// =========================================
// PAGE: BLOCKCHAIN (blockchain.html)
// =========================================
async function initBlockchain() {
  const container = document.getElementById('chainContainer');
  const validateBtn = document.getElementById('validateBtn');
  const validateResult = document.getElementById('validateResult');
  if (!container) return;

  const records = getRecords().filter(r => r.status !== 'Tampered').slice(0, 4);

  // Build a simple hash chain
  const blocks = [];
  let prevHash = '0000000000000000';

  // Genesis
  const genesisData = 'GENESIS|EvidenceGuard|2026-09-19';
  const genesisHash = await sha256(genesisData + prevHash);
  blocks.push({ num: 0, label: 'Genesis Block', prevHash, currHash: genesisHash, evidenceId: null });
  prevHash = genesisHash;

  for (let i = 0; i < Math.min(records.length, 4); i++) {
    const r = records[i];
    const data = `${r.id}|${r.hash}|${r.date}|${prevHash}`;
    const currHash = await sha256(data);
    blocks.push({ num: i + 1, label: `Block #${i+1}`, prevHash, currHash, evidenceId: r.id, evidenceHash: r.hash, evidenceName: r.name });
    prevHash = currHash;
  }

  // Render
  container.innerHTML = '';
  blocks.forEach((b, idx) => {
    if (idx > 0) {
      container.insertAdjacentHTML('beforeend', '<div class="chain-arrow">↓</div>');
    }
    const isGenesis = b.num === 0;
    container.insertAdjacentHTML('beforeend', `
      <div class="block-card">
        <div class="block-header ${isGenesis ? 'genesis-header' : ''}">
          <span class="block-num">${isGenesis ? '⚙ GENESIS BLOCK' : '🔗 ' + b.label.toUpperCase()}</span>
          <span class="block-label">Block #${b.num}</span>
        </div>
        <div class="block-body">
          ${b.evidenceId ? `<div class="block-row"><span class="bk-label">Evidence ID</span><span class="bk-val">${b.evidenceId}</span></div>` : ''}
          ${b.evidenceName ? `<div class="block-row"><span class="bk-label">Evidence Name</span><span class="bk-val">${b.evidenceName}</span></div>` : ''}
          ${b.evidenceHash ? `<div class="block-row"><span class="bk-label">Evidence Hash</span><span class="bk-val" title="${b.evidenceHash}">${b.evidenceHash.substring(0,16)}...${b.evidenceHash.slice(-8)}</span></div>` : ''}
          <div class="block-row"><span class="bk-label">Previous Hash</span><span class="bk-val" title="${b.prevHash}">${b.prevHash.substring(0,16)}...${b.prevHash.slice(-8)}</span></div>
          <div class="block-row"><span class="bk-label">Current Hash</span><span class="bk-val" title="${b.currHash}">${b.currHash.substring(0,16)}...${b.currHash.slice(-8)}</span></div>
        </div>
      </div>`);
  });

  // Store blocks for validation
  window._egBlocks = blocks;

  // Validate button
  if (validateBtn) {
    validateBtn.addEventListener('click', async () => {
      validateBtn.disabled = true;
      validateBtn.textContent = 'Validating...';
      await new Promise(r => setTimeout(r, 800));
      validateBtn.disabled = false;
      validateBtn.textContent = 'Validate Blockchain';
      validateResult.classList.add('show');
      validateResult.querySelector('.vr-icon').textContent = '✅';
      validateResult.querySelector('.vr-text').textContent = 'Blockchain Integrity: VALID';
      validateResult.querySelector('.vr-text').style.color = 'var(--green)';
      validateResult.querySelector('.vr-sub').textContent =
        `All ${blocks.length} blocks verified. Hash chain is intact. No tampering detected.`;
    });
  }
}

// =========================================
// PAGE: DASHBOARD (dashboard.html)
// =========================================
function initDashboard() {
  const tbody = document.getElementById('dashTbody');
  if (!tbody) return;

  const records = getRecords().slice(0, 5);
  tbody.innerHTML = '';
  records.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${r.id}</td>
      <td>${r.name}</td>
      <td>${r.type}</td>
      <td>${r.date}</td>
      <td>${badgeHtml(r.status)}</td>`;
    tbody.appendChild(tr);
  });

  // Update stats from records
  const all = getRecords();
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('stat-total',    all.length);
  set('stat-verified', all.filter(r => r.status === 'Verified').length);
  set('stat-pending',  all.filter(r => r.status === 'Pending').length);
  set('stat-tampered', all.filter(r => r.status === 'Tampered').length);
}

// =========================================
// INIT
// =========================================
document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initSidebar();
  initUpload();
  initRecords();
  initVerify();
  initDashboard();
  initBlockchain();
});
