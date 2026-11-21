// =========================================================================
// TALLY SHARED CLIENT UTILITY (public/js/shared.js)
// =========================================================================

// --- THEME MANAGEMENT ---
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// Run theme check immediately
initTheme();

// --- USER & AUTH MANAGEMENT ---
function getUser() {
  try {
    const raw = sessionStorage.getItem('tally_user') || localStorage.getItem('tally_user');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveUser(user) {
  if (!user) return;
  sessionStorage.setItem('tally_user', JSON.stringify(user));
  localStorage.setItem('tally_user', JSON.stringify(user));
}

function requireAuth(expectedRole = 'MANAGER') {
  const user = getUser();
  if (!user) {
    window.location.replace('/');
    return null;
  }
  if (expectedRole === 'OWNER' && user.role !== 'OWNER') {
    window.location.replace('/billing');
    return null;
  }
  if (expectedRole === 'MANAGER' && user.role === 'OWNER') {
    window.location.replace('/admin');
    return null;
  }
  return user;
}

function logout() {
  sessionStorage.removeItem('tally_user');
  localStorage.removeItem('tally_user');
  window.location.replace('/');
}

function getAuthHeaders() {
  const user = getUser();
  const headers = { 'Content-Type': 'application/json' };
  if (user && user.vendorId) {
    headers['x-vendor-id'] = user.vendorId;
  }
  return headers;
}

// --- GLOBAL SHORTCUT KEYS ---
window.addEventListener('keydown', (e) => {
  // Prevent default only for F2-F6 navigation
  if (e.key === 'F2') { e.preventDefault(); if (window.location.pathname !== '/billing') window.location.href = '/billing'; }
  if (e.key === 'F3') { e.preventDefault(); if (window.location.pathname !== '/stock') window.location.href = '/stock'; }
  if (e.key === 'F4') { e.preventDefault(); if (window.location.pathname !== '/khata') window.location.href = '/khata'; }
  if (e.key === 'F5') { e.preventDefault(); if (window.location.pathname !== '/reports') window.location.href = '/reports'; }
  if (e.key === 'F6') { e.preventDefault(); if (window.location.pathname !== '/settings') window.location.href = '/settings'; }
});

// --- STANDARD VENDOR NAVBAR RENDERER ---
function renderNavbar(activePage = 'billing') {
  const header = document.getElementById('app-header');
  if (!header) return;

  const user = getUser() || {};
  const shopName = user.shopName || (user.name ? `${user.name}'s Store` : 'Store Counter');
  const tagline = user.tagline || 'Retail & Khata Counter';
  const gstin = user.gstin || '';
  const subtext = gstin ? `GSTIN: ${gstin} | Counter POS` : 'Counter POS';
  const userInitial = (user.name || 'U').charAt(0).toUpperCase();

  const navItems = [
    { id: 'billing', label: 'Billing POS', key: 'F2', href: '/billing', icon: 'receipt' },
    { id: 'stock', label: 'Stock Master', key: 'F3', href: '/stock', icon: 'package' },
    { id: 'khata', label: 'Khata Ledger', key: 'F4', href: '/khata', icon: 'book-open' },
    { id: 'reports', label: 'Day Reports', key: 'F5', href: '/reports', icon: 'bar-chart-3' },
    { id: 'settings', label: 'Store Settings', key: 'F6', href: '/settings', icon: 'settings' }
  ];

  let navLinksHtml = navItems.map(item => {
    const isActive = activePage === item.id;
    const activeClasses = isActive
      ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400 font-semibold'
      : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200';
    return `
      <a href="${item.href}" class="tab-nav-link py-3.5 px-3 border-b-2 font-medium text-xs flex items-center gap-1.5 transition ${activeClasses}">
        <i data-lucide="${item.icon}" class="w-4 h-4"></i>
        <span>${item.label}</span>
        <span class="text-[10px] font-mono opacity-50 hidden md:inline">[${item.key}]</span>
      </a>
    `;
  }).join('');

  header.innerHTML = `
    <div class="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <a href="/billing" class="flex items-center gap-2.5 group">
          <div class="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-sm shadow group-hover:scale-105 transition">
            ${userInitial}
          </div>
          <div>
            <h1 class="font-bold text-sm text-slate-900 dark:text-white leading-tight">${shopName}</h1>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 font-mono leading-none">${subtext}</p>
          </div>
        </a>

        <!-- Desktop Navigation Tabs -->
        <nav class="hidden sm:flex items-center gap-1 ml-4 border-l border-slate-200 dark:border-slate-800 pl-4">
          ${navLinksHtml}
        </nav>
      </div>

      <div class="flex items-center gap-3">
        <!-- Theme Toggle -->
        <button onclick="toggleTheme()" title="Toggle Light/Dark Theme" class="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition">
          <i data-lucide="sun" class="w-4 h-4 hidden dark:block"></i>
          <i data-lucide="moon" class="w-4 h-4 block dark:hidden"></i>
        </button>

        <!-- User Profile Pill -->
        <div class="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
          <div class="text-right hidden sm:block">
            <span class="block text-xs font-semibold text-slate-800 dark:text-slate-200">${user.name || 'Store Admin'}</span>
            <span class="block text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">Store Active</span>
          </div>
          <button onclick="logout()" title="Logout" class="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition flex items-center gap-1 text-xs font-medium">
            <i data-lucide="log-out" class="w-4 h-4"></i>
            <span class="hidden md:inline">Logout</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Mobile Navigation Bar -->
    <div class="sm:hidden flex overflow-x-auto border-t border-slate-200 dark:border-slate-800 px-4 bg-slate-50 dark:bg-slate-900">
      ${navLinksHtml}
    </div>
  `;

  if (window.lucide) {
    lucide.createIcons();
  }
}
