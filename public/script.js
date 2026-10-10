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
      if (window.crypto && window.crypto.subtle) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const hashBuffer = await window.crypto.subtle.digest('SHA-256', arrayBuffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
          console.warn('crypto.subtle.digest failed', e);
        }
      } else {
        console.warn('crypto.subtle not available. Hash will be computed server-side.');
      }
      return null;
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
    openModal: (modalOrId) => window.openModal(modalOrId),
    closeModal: (modalOrId) => window.closeModal(modalOrId),
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
  },
  web3: {
    contractConfig: null,
    account: null,
    chainId: null,
    provider: null,
    signer: null,
    
    // Dynamically load Ethers.js if not available (local first, CDN fallback)
    loadEthers: async () => {
      if (window.ethers) return true;
      return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = '/ethers.umd.min.js';
        script.onload = () => resolve(true);
        script.onerror = () => {
          const cdnScript = document.createElement('script');
          cdnScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.11.1/ethers.umd.min.js';
          cdnScript.onload = () => resolve(true);
          cdnScript.onerror = () => {
            console.error('Failed to load ethers.js');
            resolve(false);
          };
          document.head.appendChild(cdnScript);
        };
        document.head.appendChild(script);
      });
    },

    // Load deployed contract config
    loadConfig: async () => {
      if (EG.web3.contractConfig) return EG.web3.contractConfig;
      try {
        const res = await fetch('/contract-config.json');
        if (res.ok) {
          EG.web3.contractConfig = await res.json();
          return EG.web3.contractConfig;
        }
      } catch (err) {
        console.warn('Could not load contract-config.json:', err);
      }
      return null;
    },

    // Get active contract instance on current network (with auto-deploy on Sepolia if un-deployed)
    getContract: async (isWriteMode = false) => {
      await EG.web3.loadEthers();
      const config = await EG.web3.loadConfig();
      if (!config || !config.abi) {
        throw new Error('Smart contract configuration missing.');
      }

      let provider = null;
      if (isWriteMode && EG.web3.signer && EG.web3.chainId === 11155111) {
        provider = EG.web3.provider;
      }
      if (!provider) {
        try {
          provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
        } catch (_) {
          if (EG.web3.provider) provider = EG.web3.provider;
        }
      }

      let contractAddr = localStorage.getItem('eg_sepolia_contract') || config.address;

      // Verify bytecode on target network
      let hasCode = false;
      if (contractAddr) {
        try {
          const code = await provider.getCode(contractAddr);
          hasCode = (code && code !== '0x' && code !== '0x0');
        } catch (_) {}
      }

      // If no contract bytecode exists at targetAddress and writing is needed, deploy dynamically via MetaMask
      if (!hasCode && isWriteMode && EG.web3.signer && config.bytecode) {
        EG.utils.toast('Deploying EvidenceRegistry Smart Contract to Sepolia Testnet via MetaMask...', 'info');
        const factory = new ethers.ContractFactory(config.abi, config.bytecode, EG.web3.signer);
        const deployedContract = await factory.deploy();
        await deployedContract.waitForDeployment();
        contractAddr = await deployedContract.getAddress();
        localStorage.setItem('eg_sepolia_contract', contractAddr);
        config.address = contractAddr;
        EG.utils.toast(`✅ Contract deployed on Sepolia at ${contractAddr.slice(0,6)}...${contractAddr.slice(-4)}`, 'success');
        hasCode = true;
      }

      const runner = (isWriteMode && EG.web3.signer) ? EG.web3.signer : provider;
      return {
        contract: contractAddr ? new ethers.Contract(contractAddr, config.abi, runner) : null,
        address: contractAddr,
        hasCode
      };
    },

    // Check if Web3 wallet is installed
    hasMetaMask: () => typeof window.ethereum !== 'undefined',

    // Connect Web3 Wallet (MetaMask, Phantom, Rabby, Coinbase)
    connectWallet: async () => {
      if (typeof window.ethereum === 'undefined') {
        alert('Web3 Wallet extension not detected in your browser. Please ensure MetaMask or Phantom extension is enabled.');
        EG.utils.toast('Web3 Wallet not found. Please install MetaMask or Phantom.', 'error');
        return null;
      }

      try {
        // Native EIP-1193 account request (triggers wallet popup immediately)
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (!accounts || accounts.length === 0) {
          EG.utils.toast('No wallet accounts found.', 'error');
          return null;
        }

        EG.web3.account = accounts[0];

        try {
          const hexChain = await window.ethereum.request({ method: 'eth_chainId' });
          EG.web3.chainId = parseInt(hexChain, 16);
        } catch (_) {}

        // Load ethers in background for contract functions
        EG.web3.loadEthers().then(async () => {
          if (window.ethers) {
            EG.web3.provider = new ethers.BrowserProvider(window.ethereum);
            EG.web3.signer = await EG.web3.provider.getSigner();
          }
        }).catch(err => console.warn('Ethers load:', err));

        EG.web3.updateWalletUI();
        EG.utils.toast(`Wallet Connected: ${accounts[0].substring(0, 6)}...${accounts[0].substring(38)}`, 'success');
        return accounts[0];
      } catch (err) {
        console.error('Wallet connect error:', err);
        if (err.code === 4001) {
          EG.utils.toast('Wallet connection cancelled by user.', 'warning');
        } else {
          EG.utils.toast(err.message || 'Error connecting to Wallet', 'error');
        }
        return null;
      }
    },

    // Verify user is connected to Ethereum Sepolia Testnet (Chain ID 11155111 / 0xaa36a7)
    checkSepoliaNetwork: async () => {
      if (!EG.web3.hasMetaMask() || !EG.web3.account) return false;
      const sepoliaChainId = 11155111;
      const sepoliaHexId = '0xaa36a7';

      if (EG.web3.chainId === sepoliaChainId) {
        return true;
      }

      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: sepoliaHexId }],
        });
        EG.web3.chainId = sepoliaChainId;
        EG.web3.updateWalletUI();
        return true;
      } catch (switchError) {
        // Network not added to MetaMask yet
        if (switchError.code === 4902) {
          try {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: sepoliaHexId,
                chainName: 'Ethereum Sepolia Testnet',
                nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://rpc.sepolia.org', 'https://ethereum-sepolia-rpc.publicnode.com'],
                blockExplorerUrls: ['https://sepolia.etherscan.io']
              }],
            });
            EG.web3.chainId = sepoliaChainId;
            EG.web3.updateWalletUI();
            return true;
          } catch (addErr) {
            EG.utils.toast('Failed to add Sepolia network to MetaMask.', 'error');
          }
        } else {
          EG.utils.toast('Please switch your MetaMask network to Ethereum Sepolia Testnet.', 'warning');
        }
      }
      return false;
    },

    // Initialize Wallet UI elements in topbar and setup eager account check + listeners
    initWalletUI: async () => {
      const container = document.querySelector('.topbar-right') || document.querySelector('.user-area') || document.querySelector('.topbar');
      if (!container) return;

      let userArea = container.querySelector('.user-area');
      if (!userArea) {
        userArea = document.createElement('div');
        userArea.className = 'user-area';
        userArea.style.cssText = 'display:inline-flex; align-items:center; gap:8px;';
        container.appendChild(userArea);
      }

      let badge = document.getElementById('networkBadge');
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'networkBadge';
        badge.className = 'badge';
        badge.style.cssText = 'display:none; font-size:0.75rem; padding:4px 8px; border-radius:12px; font-weight:700; margin-right:6px;';
        userArea.prepend(badge);
      }

      let btn = document.getElementById('btnConnectWallet');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'btnConnectWallet';
        btn.className = 'btn btn-secondary';
        btn.style.cssText = 'padding:5px 12px; font-size:0.82rem; font-weight:600; cursor:pointer; border-radius:6px; transition:all 0.2s ease; display:inline-flex; align-items:center; gap:5px; margin-right:8px;';
        btn.innerHTML = '🦊 Connect Wallet';
        userArea.prepend(btn);
      }

      btn.onclick = (e) => {
        e.preventDefault();
        EG.web3.connectWallet();
      };

      // Eager check if MetaMask is already connected
      if (typeof window.ethereum !== 'undefined') {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          if (accounts && accounts.length > 0) {
            EG.web3.account = accounts[0];
            try {
              const hexChain = await window.ethereum.request({ method: 'eth_chainId' });
              EG.web3.chainId = parseInt(hexChain, 16);
            } catch (_) {}

            EG.web3.loadEthers().then(async () => {
              if (window.ethers) {
                EG.web3.provider = new ethers.BrowserProvider(window.ethereum);
                EG.web3.signer = await EG.web3.provider.getSigner();
              }
            }).catch(() => {});

            EG.web3.updateWalletUI();
          }
        } catch (_) {}

        // Setup MetaMask listeners once
        if (!window._eg_web3_listeners_bound) {
          window._eg_web3_listeners_bound = true;
          try {
            window.ethereum.on('accountsChanged', (accounts) => {
              if (accounts && accounts.length > 0) {
                EG.web3.account = accounts[0];
                EG.web3.updateWalletUI();
                EG.utils.toast(`Wallet Switched: ${accounts[0].slice(0,6)}...${accounts[0].slice(-4)}`, 'info');
              } else {
                EG.web3.account = null;
                EG.web3.updateWalletUI();
                EG.utils.toast('Wallet disconnected', 'warning');
              }
            });
            window.ethereum.on('chainChanged', (hexChainId) => {
              EG.web3.chainId = parseInt(hexChainId, 16);
              EG.web3.updateWalletUI();
            });
          } catch (_) {}
        }
      }
    },

    // Update Topbar UI with Wallet Address & Sepolia status
    updateWalletUI: () => {
      const btn = document.getElementById('btnConnectWallet');
      const badge = document.getElementById('networkBadge');

      if (badge) {
        if (EG.web3.chainId === 11155111) {
          badge.textContent = 'Sepolia Testnet';
          badge.className = 'badge badge-verified';
          badge.style.display = 'inline-block';
          badge.style.background = 'rgba(46, 204, 113, 0.2)';
          badge.style.color = '#2ecc71';
          badge.style.border = '1px solid #2ecc71';
        } else if (EG.web3.account) {
          badge.textContent = `Chain ${EG.web3.chainId} (Switch to Sepolia)`;
          badge.className = 'badge badge-tampered';
          badge.style.display = 'inline-block';
          badge.style.background = 'rgba(231, 76, 60, 0.2)';
          badge.style.color = '#e74c3c';
          badge.style.border = '1px solid #e74c3c';
        } else {
          badge.style.display = 'none';
        }
      }

      if (btn) {
        if (EG.web3.account) {
          const shortAddr = `${EG.web3.account.substring(0, 6)}...${EG.web3.account.substring(38)}`;
          btn.innerHTML = `🦊 ${shortAddr}`;
          btn.title = `Connected: ${EG.web3.account}`;
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-primary');
          btn.style.background = 'linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%)';
          btn.style.color = '#ffffff';
        } else {
          btn.innerHTML = `🦊 Connect Wallet`;
          btn.title = `Connect to Web3 Wallet`;
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-secondary');
          btn.style.background = '';
          btn.style.color = '';
        }
      }

      // Update dashboard wallet status readout if present
      const dashWallet = document.getElementById('dashWalletDisplay');
      if (dashWallet) {
        if (EG.web3.account) {
          dashWallet.innerHTML = `<span style="color:var(--status-verified); font-weight:bold;">${EG.web3.account.slice(0,6)}...${EG.web3.account.slice(-4)}</span>`;
        } else {
          dashWallet.innerHTML = `<button type="button" class="btn btn-secondary" onclick="EG.web3.connectWallet()" style="padding:2px 8px; font-size:0.75rem;">🦊 Connect Wallet</button>`;
        }
      }
    },

    // Register evidence directly on Solidity smart contract
    registerOnChain: async ({ evidenceId, sha256Hash, evidenceName, evidenceType, description }) => {
      if (!EG.web3.account) {
        const connected = await EG.web3.connectWallet();
        if (!connected) throw new Error('MetaMask wallet connection required to register on Sepolia.');
      }

      const isSepolia = await EG.web3.checkSepoliaNetwork();
      if (!isSepolia && EG.web3.chainId !== 31337) { // Allow local hardhat testing too
        throw new Error('Please switch MetaMask network to Ethereum Sepolia Testnet.');
      }

      await EG.web3.loadEthers();
      if (!EG.web3.signer && EG.web3.provider) {
        EG.web3.signer = await EG.web3.provider.getSigner();
      }

      const { contract, address, hasCode } = await EG.web3.getContract(true);
      if (!contract || !hasCode) {
        throw new Error('Could not initialize EvidenceRegistry smart contract on Sepolia.');
      }

      // Check duplicate on-chain first
      try {
        const exists = await contract.evidenceExists(evidenceId);
        if (exists) {
          throw new Error(`Evidence ID ${evidenceId} is already registered on the blockchain.`);
        }
      } catch (chkErr) {
        if (chkErr.message && chkErr.message.includes('already registered')) throw chkErr;
      }

      // Execute smart contract transaction
      const tx = await contract.registerEvidence(
        evidenceId,
        sha256Hash,
        evidenceName || 'Untitled Evidence',
        evidenceType || 'Unknown',
        description || ''
      );

      // Wait for blockchain block confirmation
      const receipt = await tx.wait();

      return {
        evidenceId,
        sha256Hash,
        txHash: receipt.hash,
        blockNumber: Number(receipt.blockNumber),
        contractAddress: address,
        uploader: EG.web3.account,
        network: 'Ethereum Sepolia Testnet',
        timestamp: new Date().toISOString()
      };
    },

    // Fetch evidence record directly from Solidity smart contract
    getEvidenceFromChain: async (evidenceId) => {
      await EG.web3.loadEthers();
      const { contract, address, hasCode } = await EG.web3.getContract(false);
      if (!contract || !hasCode) {
        return null;
      }

      try {
        const exists = await contract.evidenceExists(evidenceId);
        if (!exists) return null;

        const res = await contract.getEvidence(evidenceId);
        return {
          evidenceId: res[0],
          sha256Hash: res[1],
          evidenceName: res[2],
          evidenceType: res[3],
          description: res[4],
          timestamp: new Date(Number(res[5]) * 1000).toISOString(),
          uploader: res[6],
          contractAddress: address,
          network: 'Ethereum Sepolia Testnet'
        };
      } catch (err) {
        console.warn('On-chain read error:', err);
        return null;
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
    if (submitBtn) {
      submitBtn.dataset.originalText = submitBtn.innerHTML || submitBtn.value;
      setTimeout(() => {
        if (submitBtn && !submitBtn.disabled && submitBtn.classList.contains('btn-loading')) {
          submitBtn.disabled = false;
          submitBtn.classList.remove('btn-loading');
          if (submitBtn.dataset.originalText) {
            if (submitBtn.tagName === 'INPUT') submitBtn.value = submitBtn.dataset.originalText;
            else submitBtn.innerHTML = submitBtn.dataset.originalText;
          }
        }
      }, 10000);
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

// Universal modal management
function openModal(modalOrId) {
  const el = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
  if (!el) return;
  el.classList.add('active');
  el.style.display = 'flex';
  el.setAttribute('aria-hidden', 'false');
}

function closeModal(modalOrId) {
  const el = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
  if (!el) return;
  el.classList.remove('active');
  el.style.display = 'none';
  el.setAttribute('aria-hidden', 'true');
}

window.openModal = openModal;
window.closeModal = closeModal;

function setupUniversalModals() {
  document.addEventListener('click', (e) => {
    // 1. Check if clicked directly on overlay background
    if (e.target && (e.target.classList.contains('modal-overlay') || e.target.classList.contains('modal'))) {
      closeModal(e.target);
      return;
    }

    // 2. Check if clicked element or its ancestor is a close/cancel button
    const closeBtn = e.target.closest(
      '.modal-close, .btn-close, [data-dismiss="modal"], button[id*="close" i], button[id*="Close"], button[id*="cancel" i], button[id*="Cancel"], .btn-cancel, .close-modal'
    );
    if (closeBtn) {
      const parentModal = closeBtn.closest('.modal-overlay, .modal');
      if (parentModal) {
        closeModal(parentModal);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModals = document.querySelectorAll('.modal-overlay.active, .modal.active, .modal-overlay[style*="flex"], .modal[style*="flex"]');
      openModals.forEach(m => closeModal(m));
    }
  });
}

// Common shell logic
document.addEventListener('DOMContentLoaded', () => {
  EG.utils.highlightNav();
  setupDoubleSubmitProtection();
  setupOfflineBanner();
  setupMobileSidebar();
  setupUniversalModals();

  const publicPages = ['index.html', 'login.html', 'register.html', 'about.html', ''];
  const currentPath = location.pathname.split('/').pop() || 'index.html';
  const searchParams = new URLSearchParams(window.location.search);
  const isPublicVerify = currentPath === 'verify.html' && (searchParams.has('caseId') || searchParams.has('t'));
  
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

  // Inject Connect Wallet button into header topbar if topbar-right exists
  const topbarRight = document.querySelector('.topbar-right');
  if (topbarRight && !document.getElementById('btnConnectWallet')) {
    const walletWrap = document.createElement('div');
    walletWrap.style.cssText = 'display:flex; align-items:center; gap:8px; margin-right:10px;';
    walletWrap.innerHTML = `
      <span id="networkBadge" class="badge badge-verified" style="display:none; font-size:0.75rem;">Sepolia</span>
      <button type="button" id="btnConnectWallet" class="btn btn-secondary" style="padding:0.3rem 0.65rem; font-size:0.8rem; font-weight:500;">
        🦊 Connect Wallet
      </button>
    `;
    topbarRight.insertBefore(walletWrap, topbarRight.firstChild);
  }

  const btnConnect = document.getElementById('btnConnectWallet');
  if (btnConnect) {
    btnConnect.addEventListener('click', () => {
      EG.web3.connectWallet();
    });
  }

  // Pre-load contract config
  EG.web3.loadConfig();

  // Auto-detect connected MetaMask account if already unlocked
  if (window.ethereum && window.ethereum.selectedAddress) {
    EG.web3.account = window.ethereum.selectedAddress;
    if (window.ethereum.chainId) {
      EG.web3.chainId = parseInt(window.ethereum.chainId, 16);
    }
    EG.web3.updateWalletUI();
  }

  // Listen for MetaMask account & network changes
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', (accounts) => {
      if (accounts && accounts.length > 0) {
        EG.web3.account = accounts[0];
        EG.utils.toast(`Switched Wallet Account: ${accounts[0].substring(0, 6)}...`, 'info');
      } else {
        EG.web3.account = null;
        EG.utils.toast('Wallet Disconnected.', 'warning');
      }
      EG.web3.updateWalletUI();
    });

    window.ethereum.on('chainChanged', (hexChainId) => {
      EG.web3.chainId = parseInt(hexChainId, 16);
      EG.web3.updateWalletUI();
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

window.connectWallet = () => EG.web3.connectWallet();
