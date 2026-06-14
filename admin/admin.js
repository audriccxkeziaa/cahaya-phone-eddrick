// // ============================================
// // ADMIN PANEL JAVASCRIPT
// // ============================================

// const API_URL = 'http://localhost:5000/api';

// // Global state
// let token = localStorage.getItem('token');
// let admin = JSON.parse(localStorage.getItem('admin') || '{}');
// let allCustomers = [];
// let allMessages = [];

// // ============================================
// // LOGIN PAGE
// // ============================================

// const loginForm = document.getElementById('loginForm');
// if (loginForm) {
//     const loginBtn = document.getElementById('loginBtn');
//     const loginAlert = document.getElementById('loginAlert');
//     console.log('🔐 Admin login script initialized. Found loginForm:', !!loginForm);

//     function showLoginAlert(message, type = 'error') {
//         loginAlert.textContent = message;
//         loginAlert.className = `alert ${type} show`;
        
//         setTimeout(() => {
//             loginAlert.classList.remove('show');
//         }, 5000);
//     }

//     loginForm.addEventListener('submit', async (e) => {
//         e.preventDefault();
        
//         const username = document.getElementById('username').value;
//         const password = document.getElementById('password').value;

//         loginBtn.disabled = true;
//         loginBtn.textContent = 'Loading...';

//         try {
//             const response = await fetch(`${API_URL}/admin/login`, {
//                 method: 'POST',
//                 headers: {
//                     'Content-Type': 'application/json'
//                 },
//                 body: JSON.stringify({ username, password })
//             });

//             const result = await response.json();

//             if (result.success) {
//                 localStorage.setItem('token', result.token);
//                 localStorage.setItem('admin', JSON.stringify(result.admin));
                
//                 window.location.href = 'dashboard.html';
//             } else {
//                 showLoginAlert('❌ ' + result.message, 'error');
//             }
//         } catch (error) {
//             console.error('Login error:', error);
//             showLoginAlert('❌ Tidak dapat terhubung ke server', 'error');
//         }

//         loginBtn.disabled = false;
//         loginBtn.textContent = 'Login';
//     });
// }

// // ============================================
// // DASHBOARD PAGE
// // ============================================

// if (window.location.pathname.includes('dashboard.html')) {
//     // Check authentication
//     if (!token) {
//         window.location.href = 'index.html';
//     }

//     // Display admin name
//     document.getElementById('adminName').textContent = `Hello, ${admin.nama || 'Admin'}`;

//     // ============================================
//     // NAVIGATION
//     // ============================================

//     const navItems = document.querySelectorAll('.nav-item');
//     const pages = document.querySelectorAll('.page');

//     navItems.forEach(item => {
//         item.addEventListener('click', (e) => {
//             e.preventDefault();
            
//             const targetPage = item.dataset.page;
            
//             // Update nav
//             navItems.forEach(nav => nav.classList.remove('active'));
//             item.classList.add('active');
            
//             // Update page
//             pages.forEach(page => page.classList.remove('active'));
//             document.getElementById(targetPage + 'Page').classList.add('active');
            
//             // Load page data
//             if (targetPage === 'dashboard') {
//                 loadDashboard();
//             } else if (targetPage === 'customers') {
//                 loadCustomers();
//             } else if (targetPage === 'messages') {
//                 loadMessages();
//             }
//         });
//     });

//     // ============================================
//     // API CALLS
//     // ============================================

//     async function apiCall(endpoint, options = {}) {
//         try {
//             const response = await fetch(`${API_URL}${endpoint}`, {
//                 ...options,
//                 headers: {
//                     'Content-Type': 'application/json',
//                     'Authorization': `Bearer ${token}`,
//                     ...options.headers
//                 }
//             });

//             if (response.status === 401) {
//                 logout();
//                 return null;
//             }

//             return await response.json();
//         } catch (error) {
//             console.error('API call error:', error);
//             return null;
//         }
//     }

//     // ============================================
//     // DASHBOARD
//     // ============================================

//     async function loadDashboard() {
//         try {
//             // Load statistics
//             const stats = await apiCall('/admin/stats');
            
//             if (stats && stats.success) {
//                 document.getElementById('totalCustomers').textContent = stats.data.total_customers || 0;
//                 document.getElementById('fromInstagram').textContent = stats.data.from_instagram || 0;
//                 document.getElementById('fromWebsite').textContent = stats.data.from_website || 0;
//                 document.getElementById('newCustomers').textContent = stats.data.new_customers || 0;
//             }

//             // Load recent customers
//             const customers = await apiCall('/admin/customers');
            
//             if (customers && customers.success) {
//                 displayRecentCustomers(customers.data.slice(0, 5));
//             }
//         } catch (error) {
//             console.error('Load dashboard error:', error);
//         }
//     }

//     function displayRecentCustomers(customers) {
//         const container = document.getElementById('recentCustomers');
        
//         if (customers.length === 0) {
//             container.innerHTML = '<div class="no-data">Belum ada customer</div>';
//             return;
//         }

//         let html = `
//             <table>
//                 <thead>
//                     <tr>
//                         <th>Nama</th>
//                         <th>WhatsApp</th>
//                         <th>Sales</th>
//                         <th>Source</th>
//                         <th>Status</th>
//                         <th>Tanggal</th>
//                     </tr>
//                 </thead>
//                 <tbody>
//         `;

//         customers.forEach(customer => {
//             const date = new Date(customer.created_at).toLocaleDateString('id-ID');
//             const sourceClass = customer.source.toLowerCase();
//             const statusClass = customer.status.toLowerCase();
            
//             html += `
//                 <tr>
//                     <td>${customer.nama_lengkap}</td>
//                     <td>${customer.whatsapp}</td>
//                     <td>${customer.nama_sales || '-'}</td>
//                     <td><span class="badge ${sourceClass}">${customer.source}</span></td>
//                     <td><span class="badge ${statusClass}">${customer.status}</span></td>
//                     <td>${date}</td>
//                 </tr>
//             `;
//         });

//         html += '</tbody></table>';
//         container.innerHTML = html;
//     }

//     // ============================================
//     // CUSTOMERS PAGE
//     // ============================================

//     async function loadCustomers() {
//         const container = document.getElementById('customersTable');
//         container.innerHTML = '<div class="loading">Loading...</div>';

//         const result = await apiCall('/admin/customers');
        
//         if (result && result.success) {
//             allCustomers = result.data;
//             displayCustomers(allCustomers);
//         } else {
//             container.innerHTML = '<div class="no-data">Gagal memuat data</div>';
//         }
//     }

//     function displayCustomers(customers) {
//         const container = document.getElementById('customersTable');
        
//         if (customers.length === 0) {
//             container.innerHTML = '<div class="no-data">Belum ada customer</div>';
//             return;
//         }

//         let html = `
//             <table>
//                 <thead>
//                     <tr>
//                         <th>No</th>
//                         <th>Nama</th>
//                         <th>WhatsApp</th>
//                         <th>Sales</th>
//                         <th>Produk</th>
//                         <th>Harga</th>
//                         <th>Metode</th>
//                         <th>Source</th>
//                         <th>Status</th>
//                         <th>Tanggal</th>
//                         <th>Aksi</th>
//                     </tr>
//                 </thead>
//                 <tbody>
//         `;

//         customers.forEach((customer, index) => {
//             const date = new Date(customer.created_at).toLocaleDateString('id-ID');
//             const sourceClass = customer.source.toLowerCase();
//             const statusClass = customer.status.toLowerCase();
//             const produk = customer.merk_unit && customer.tipe_unit 
//                 ? `${customer.merk_unit} ${customer.tipe_unit}` 
//                 : '-';
//             const harga = customer.harga 
//                 ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(customer.harga)
//                 : '-';
            
//             html += `
//                 <tr>
//                     <td>${index + 1}</td>
//                     <td>${customer.nama_lengkap}</td>
//                     <td>${customer.whatsapp}</td>
//                     <td>${customer.nama_sales || '-'}</td>
//                     <td>${produk}</td>
//                     <td>${harga}</td>
//                     <td>${customer.metode_pembayaran || '-'}</td>
//                     <td><span class="badge ${sourceClass}">${customer.source}</span></td>
//                     <td><span class="badge ${statusClass}">${customer.status}</span></td>
//                     <td>${date}</td>
//                     <td>
//                         <div class="table-actions">
//                             <button class="btn-small" onclick="viewCustomer(${customer.id})">Detail</button>
//                         </div>
//                     </td>
//                 </tr>
//             `;
//         });

//         html += '</tbody></table>';
//         container.innerHTML = html;
//     }

//     // Search customer
//     document.getElementById('searchCustomer').addEventListener('input', (e) => {
//         const search = e.target.value.toLowerCase();
//         const filtered = allCustomers.filter(customer => 
//             customer.nama_lengkap.toLowerCase().includes(search) ||
//             customer.whatsapp.includes(search) ||
//             (customer.nama_sales && customer.nama_sales.toLowerCase().includes(search))
//         );
//         displayCustomers(filtered);
//     });

//     // Filter by source
//     document.getElementById('filterSource').addEventListener('change', (e) => {
//         const source = e.target.value;
//         const filtered = source 
//             ? allCustomers.filter(customer => customer.source === source)
//             : allCustomers;
//         displayCustomers(filtered);
//     });

//     // View customer detail
//     window.viewCustomer = async function(customerId) {
//         const result = await apiCall(`/admin/customers/${customerId}`);
        
//         if (result && result.success) {
//             showCustomerDetail(result.data);
//         }
//     };

//     function showCustomerDetail(customer) {
//         const modal = document.getElementById('customerModal');
//         const detail = document.getElementById('customerDetail');
        
//         const date = new Date(customer.created_at).toLocaleString('id-ID');
//         const harga = customer.harga 
//             ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(customer.harga)
//             : '-';
        
//         detail.innerHTML = `
//             <div class="detail-group">
//                 <div class="detail-label">Nama Lengkap</div>
//                 <div class="detail-value">${customer.nama_lengkap}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">WhatsApp</div>
//                 <div class="detail-value">${customer.whatsapp}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Nama Sales</div>
//                 <div class="detail-value">${customer.nama_sales || '-'}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Produk</div>
//                 <div class="detail-value">${customer.merk_unit || '-'} ${customer.tipe_unit || ''}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Harga</div>
//                 <div class="detail-value">${harga}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Qty</div>
//                 <div class="detail-value">${customer.qty || '-'}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Tanggal Lahir</div>
//                 <div class="detail-value">${customer.tanggal_lahir || '-'}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Alamat</div>
//                 <div class="detail-value">${customer.alamat || '-'}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Metode Pembayaran</div>
//                 <div class="detail-value">${customer.metode_pembayaran || '-'}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Tahu dari</div>
//                 <div class="detail-value">${customer.tahu_dari || '-'}</div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Source</div>
//                 <div class="detail-value"><span class="badge ${customer.source.toLowerCase()}">${customer.source}</span></div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Status</div>
//                 <div class="detail-value"><span class="badge ${customer.status.toLowerCase()}">${customer.status}</span></div>
//             </div>
//             <div class="detail-group">
//                 <div class="detail-label">Tanggal Daftar</div>
//                 <div class="detail-value">${date}</div>
//             </div>
//         `;
        
//         modal.classList.add('show');
//     }

//     window.closeModal = function() {
//         document.getElementById('customerModal').classList.remove('show');
//     };

//     // Close modal on backdrop click
//     document.getElementById('customerModal').addEventListener('click', (e) => {
//         if (e.target.id === 'customerModal') {
//             closeModal();
//         }
//     });

//     // ============================================
//     // MESSAGES PAGE
//     // ============================================

//     async function loadMessages() {
//         const container = document.getElementById('messagesTable');
//         container.innerHTML = '<div class="loading">Loading...</div>';

//         const result = await apiCall('/admin/messages');
        
//         if (result && result.success) {
//             allMessages = result.data;
//             displayMessages(allMessages);
//         } else {
//             container.innerHTML = '<div class="no-data">Gagal memuat data</div>';
//         }
//     }

//     function displayMessages(messages) {
//         const container = document.getElementById('messagesTable');
        
//         if (messages.length === 0) {
//             container.innerHTML = '<div class="no-data">Belum ada pesan</div>';
//             return;
//         }

//         let html = `
//             <table>
//                 <thead>
//                     <tr>
//                         <th>No</th>
//                         <th>Nama Customer</th>
//                         <th>WhatsApp</th>
//                         <th>Arah</th>
//                         <th>Pesan</th>
//                         <th>Waktu</th>
//                     </tr>
//                 </thead>
//                 <tbody>
//         `;

//         messages.forEach((msg, index) => {
//             const time = formatWaktu(msg.sent_at);
//             const directionClass = msg.direction;
//             const directionText = msg.direction === 'in' ? 'Masuk' : 'Keluar';
            
//             html += `
//                 <tr>
//                     <td>${index + 1}</td>
//                     <td>${msg.nama_lengkap}</td>
//                     <td>${msg.whatsapp}</td>
//                     <td><span class="badge ${directionClass}">${directionText}</span></td>
//                     <td style="max-width: 300px;">${msg.message}</td>
//                     <td>${time}</td>
//                 </tr>
//             `;
//         });

//         html += '</tbody></table>';
//         container.innerHTML = html;
//     }

//     // ============================================
//     // LOGOUT
//     // ============================================

//     window.logout = function() {
//         localStorage.removeItem('token');
//         localStorage.removeItem('admin');
//         window.location.href = 'index.html';
//     };

//     // ============================================
//     // INITIAL LOAD
//     // ============================================

//     loadDashboard();
// }

// console.log('✅ Admin Panel initialized');
// console.log('📡 API URL:', API_URL);

// ============================================
// ADMIN PANEL JAVASCRIPT
// ============================================

const API_URL = '/api';
const TIMEZONE = 'Asia/Makassar'; // WITA (UTC+8) - Gorontalo

// Helper: get date string YYYY-MM-DD in WITA timezone
function toWITADate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('sv-SE', { timeZone: TIMEZONE }); // sv-SE gives YYYY-MM-DD
}

// Helper: escape HTML entities so user-supplied values (customer names, addresses,
// incoming WA message content, etc.) can't break out of an attribute or inject a
// <script> tag. Use this for ANY value that originated from a form, webhook, or
// other untrusted source before interpolating into innerHTML.
function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Helper: format date in Indonesian locale with WITA timezone
function formatTanggal(date, options = {}) {
    const defaults = { timeZone: TIMEZONE };
    return new Date(date).toLocaleDateString('id-ID', { ...defaults, ...options });
}

// Helper: format date+time in Indonesian locale with WITA timezone
function formatWaktu(date) {
    return new Date(date).toLocaleString('id-ID', { timeZone: TIMEZONE });
}

function showAdminToast(message, type = 'success') {
    const existing = document.getElementById('adminToastNotification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'adminToastNotification';
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.top = '22px';
    toast.style.right = '22px';
    toast.style.zIndex = '9999';
    toast.style.maxWidth = '320px';
    toast.style.padding = '14px 18px';
    toast.style.borderRadius = '12px';
    toast.style.boxShadow = '0 20px 60px rgba(0,0,0,0.12)';
    toast.style.color = '#111827';
    toast.style.fontSize = '13px';
    toast.style.fontWeight = '600';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'opacity 180ms ease-out, transform 180ms ease-out';

    if (type === 'success') {
        toast.style.background = '#DEF7EC';
        toast.style.border = '1px solid #34D399';
    } else if (type === 'error') {
        toast.style.background = '#FEE2E2';
        toast.style.border = '1px solid #F87171';
    } else {
        toast.style.background = '#F8FAFC';
        toast.style.border = '1px solid #D1D5DB';
    }

    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    window.setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        window.setTimeout(() => toast.remove(), 220);
    }, 4200);
}

// Helper: get the relevant activity date for a customer.
// - Belanja: latest purchase date
// - Chat Only: latest incoming message date
// - Fallback to created_at when neither available
function customerActivityDate(c) {
    if ((c.tipe || 'Belanja') === 'Chat Only') {
        return c.last_incoming_message_at || c.created_at;
    }
    return c.last_purchase_at || c.created_at;
}

// Global state
// NOTE: JWT auth token is now stored in an httpOnly cookie (set by the server on
// login) which JS cannot read — XSS-resistant. The CSRF token is in a normal
// cookie that we mirror back to the server as a header on every write.
let admin = JSON.parse(localStorage.getItem('admin') || '{}');
let allCustomers = [];
let allMessages = [];
let purchaseMetadata = { merk_units: [], metode_pembayaran: [] };

// Read CSRF token from cookie. Returns empty string if not present (e.g. logged out).
function getCsrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
}

// ============================================
// LOGOUT FUNCTION (Global - dipindah ke sini agar bisa dipanggil dari HTML)
// ============================================

window.logout = async function() {
    console.log('🚪 Logging out...');
    try {
        await fetch(`${API_URL}/admin/logout`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-CSRF-Token': getCsrfToken() }
        });
    } catch (_) { /* server unreachable — clear locally anyway */ }
    localStorage.removeItem('admin');
    // Belt-and-suspenders: clear the readable csrf cookie too (auth_token is httpOnly
    // so the server-side clearCookie is the source of truth for it).
    document.cookie = 'csrf_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.location.href = 'index.html';
};

// ============================================
// LOGIN PAGE
// ============================================

const loginForm = document.getElementById('loginForm');
if (loginForm) {
    const loginBtn = document.getElementById('loginBtn');
    const loginAlert = document.getElementById('loginAlert');
    console.log('🔐 Admin login script initialized. Found loginForm:', !!loginForm);

    function showLoginAlert(message, type = 'error') {
        loginAlert.textContent = message;
        loginAlert.className = `alert ${type} show`;
        
        setTimeout(() => {
            loginAlert.classList.remove('show');
        }, 5000);
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        loginBtn.disabled = true;
        loginBtn.textContent = 'Loading...';

        try {
            console.log('📡 Attempting login...');
            const response = await fetch(`${API_URL}/admin/login`, {
                method: 'POST',
                credentials: 'include',          // accept httpOnly auth_token cookie
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const result = await response.json();
            console.log('📨 Login response:', result.success ? '(success)' : result);

            if (result.success) {
                // No more localStorage.setItem('token') — JWT lives in an httpOnly cookie now.
                // We only keep admin profile info (role for UI gating) in localStorage.
                localStorage.setItem('admin', JSON.stringify(result.admin));
                console.log('✅ Login successful, redirecting...');
                window.location.href = 'dashboard.html';
            } else {
                showLoginAlert('❌ ' + result.message, 'error');
            }
        } catch (error) {
            console.error('❌ Login error:', error);
            showLoginAlert('❌ Tidak dapat terhubung ke server. Pastikan backend sudah jalan!', 'error');
        }

        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
    });
}

// ============================================
// DASHBOARD PAGE
// ============================================

// Support both URL forms: /dashboard and /dashboard.html
if (window.location.pathname.includes('dashboard') || window.location.pathname.includes('dashboard.html')) {
    console.log('📊 Loading dashboard...');
    
    // Check authentication: presence of csrf_token cookie is a quick "have I logged in"
    // signal. The actual auth is verified server-side via the httpOnly auth_token cookie
    // on every API call — if that cookie is missing/expired, apiCall() catches the 401
    // and triggers logout(), so this is just a fast first-paint redirect.
    if (!getCsrfToken()) {
        console.warn('⚠️ No CSRF cookie found, redirecting to login...');
        window.location.href = 'index.html';
    }

    // Display admin greeting
    function renderAdminName() {
        const name = admin.nama || admin.username || 'Admin';
        document.getElementById('adminName').textContent = `Welcome back, ${name}`;
    }

    renderAdminName();
    console.log('👤 Admin:', admin.nama || admin.username || 'Admin');

    // ============================================
    // NAVIGATION
    // ============================================

    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            const targetPage = item.dataset.page;
            console.log('📄 Navigating to:', targetPage);
            
            // Update nav
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Update page
            pages.forEach(page => page.classList.remove('active'));
            document.getElementById(targetPage + 'Page').classList.add('active');

            // Stop WA polling when leaving waconnect page
            if (targetPage !== 'waconnect') {
                _waStopPolling();
                _waStopAutoPoll();
            }

            // Load page data
            if (targetPage === 'dashboard') {
                loadDashboard();
            } else if (targetPage === 'customers') {
                loadCustomers();
            } else if (targetPage === 'analytics') {
                loadAnalytics();
            } else if (targetPage === 'birthday') {
                loadBirthdayPage();
            } else if (targetPage === 'waconnect') {
                loadWAStatus();
                loadWAAutoReply();
                loadFailedWA();
            } else if (targetPage === 'messages') {
                loadMessages();
                loadCleanupStatus();
            } else if (targetPage === 'settings') {
                loadSettingsPage();
            }
        });
    });

    // ============================================
    // API CALLS
    // ============================================

    // Auto-retry transient failures (backend restart, transient 5xx, network blip).
    // Retries with exponential backoff + jitter; 401 / 4xx still fail-fast because
    // those mean the request itself is wrong, not the network.
    async function apiCall(endpoint, options = {}, _attempt = 0) {
        const MAX_RETRIES = 3;
        const method = (options.method || 'GET').toUpperCase();
        const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);

        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        if (isWrite) {
            headers['X-CSRF-Token'] = getCsrfToken();
        }

        try {
            const response = await fetch(`${API_URL}${endpoint}`, {
                ...options,
                credentials: 'include',
                headers
            });

            if (response.status === 401) {
                logout();
                return null;
            }

            // Transient server errors → backoff + retry. 500 also retried once because
            // Railway sometimes returns 500 during deploy switchover.
            const retryableStatus = [500, 502, 503, 504];
            if (retryableStatus.includes(response.status) && _attempt < MAX_RETRIES) {
                const backoff = 400 * Math.pow(2, _attempt) + Math.random() * 300;
                console.warn(`[apiCall] ${response.status} on ${endpoint}, retry ${_attempt + 1}/${MAX_RETRIES} in ${Math.round(backoff)}ms`);
                await new Promise(r => setTimeout(r, backoff));
                return apiCall(endpoint, options, _attempt + 1);
            }

            return await response.json();
        } catch (error) {
            // Network error (fetch threw — DNS, connection refused, etc). Backend
            // probably restarting; back off and try again.
            if (_attempt < MAX_RETRIES) {
                const backoff = 400 * Math.pow(2, _attempt) + Math.random() * 300;
                console.warn(`[apiCall] Network error on ${endpoint}, retry ${_attempt + 1}/${MAX_RETRIES} in ${Math.round(backoff)}ms`);
                await new Promise(r => setTimeout(r, backoff));
                return apiCall(endpoint, options, _attempt + 1);
            }
            console.error('API error after retries:', error);
            return null;
        }
    }

    // ============================================
    // DASHBOARD
    // ============================================

    // End-of-month backup reminder banner. Backend computes showBanner =
    // (today is last day of month) AND (haven't cleaned this month) AND
    // (there is new data since last cleanup). So the banner only appears
    // on the natural "saatnya" day, and stops appearing once cleanup is done.
    async function loadBackupBanner() {
        try {
            const result = await apiCall('/admin/backup/status');
            if (!result || !result.success) return;
            const data = result.data;
            // Always sync the Customer-tab backup button state, regardless of banner.
            syncBackupButtonState(data);

            if (!data.showBanner) return;

            const dismissedKey = 'backupBannerDismissedUntil';
            const dismissedUntil = localStorage.getItem(dismissedKey);
            if (dismissedUntil && new Date(dismissedUntil) > new Date()) return;

            const banner = document.getElementById('backupBanner');
            if (!banner) return;

            // End-of-month = warning palette (amber)
            banner.style.background = '#FEF3C7';
            banner.style.borderColor = '#FDE68A';
            banner.style.color = '#92400E';

            const titleEl = document.getElementById('backupBannerTitle');
            const msgEl = document.getElementById('backupBannerMessage');
            titleEl.textContent = `Saatnya backup + cleanup akhir bulan (tgl ${data.todayDayOfMonth})`;
            msgEl.textContent = 'Download CSV lengkap dulu untuk arsip → lalu cleanup data log. Customer & riwayat pembelian TIDAK dihapus, hanya chat log & WA log (yang juga tersimpan di HP).';

            banner.style.display = 'block';

            const goToCustomerTab = (autoClickBtnId) => {
                const navLink = document.querySelector('a.nav-item[data-page="customers"]');
                if (navLink) {
                    navLink.click();
                    setTimeout(() => {
                        if (autoClickBtnId) document.getElementById(autoClickBtnId)?.click();
                    }, 250);
                } else {
                    document.getElementById('customersPage')?.scrollIntoView({ behavior: 'smooth' });
                }
            };
            document.getElementById('backupBannerDownload').onclick = () => goToCustomerTab('customerBackupBtn');
            const bannerCleanup = document.getElementById('backupBannerCleanup');
            if (bannerCleanup) bannerCleanup.style.display = 'none';

            document.getElementById('backupBannerDismiss').onclick = () => {
                const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                localStorage.setItem(dismissedKey, sevenDaysLater.toISOString());
                banner.style.display = 'none';
            };
        } catch (e) {
            console.warn('loadBackupBanner failed:', e.message);
        }
    }

    // Sync the Customer-tab backup button: enabled when there's new activity
    // since the last monthly cleanup, otherwise disabled with an explanatory
    // tooltip. Called from loadBackupBanner() so the button stays accurate
    // whenever the dashboard loads.
    function syncBackupButtonState(statusData) {
        const btn = document.getElementById('customerBackupBtn');
        if (!btn) return;
        if (statusData.canBackup === false) {
            btn.disabled = true;
            btn.title = 'Tunggu data baru masuk. Backup baru bisa dilakukan setelah cleanup terakhir + ada aktivitas baru.';
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        } else {
            btn.disabled = false;
            btn.title = 'Download SEMUA data (customer + purchases + dll) sebagai 1 CSV';
            btn.style.opacity = '';
            btn.style.cursor = '';
        }
    }

    // Railway billing reminder banner. Only renders on H..H+2 (backend gates).
    // Two dismiss paths:
    //   - "Buka Railway" (link click) → treat as paid → hard-dismiss this whole
    //     billing cycle via billingBannerPaidCycle. Banner returns next month
    //     automatically because cycleKey changes.
    //   - "Tutup hari ini" → per-day soft dismiss. Banner comes back tomorrow
    //     so the owner keeps getting nudged until they actually open Railway.
    async function loadBillingBanner() {
        try {
            const result = await apiCall('/admin/billing-status');
            if (!result || !result.success || !result.data.show) return;

            const data = result.data;
            const today = new Date().toISOString().slice(0, 10);

            // Hard dismiss: user already opened Railway this cycle → assume paid
            if (data.cycleKey && localStorage.getItem('billingBannerPaidCycle') === data.cycleKey) return;

            const dismissed = localStorage.getItem('billingBannerDismissedDate');
            if (dismissed === today) return;  // soft dismiss for today only

            const banner = document.getElementById('billingBanner');
            if (!banner) return;

            const palette = {
                urgent:  { bg: '#FEE2E2', border: '#FCA5A5', color: '#991B1B', icon: '🚨' },
                overdue: { bg: '#FEE2E2', border: '#DC2626', color: '#7F1D1D', icon: '⚠️' }
            }[data.severity] || { bg: '#F3F4F6', border: '#D1D5DB', color: '#374151', icon: '💳' };

            banner.style.background = palette.bg;
            banner.style.borderColor = palette.border;
            banner.style.color = palette.color;
            document.getElementById('billingIcon').textContent = palette.icon;
            document.getElementById('billingTitle').textContent = esc(data.title);
            document.getElementById('billingMessage').textContent = esc(data.message);
            banner.style.display = 'block';

            const openLink = document.getElementById('billingOpenRailway');
            if (openLink && data.cycleKey) {
                openLink.onclick = () => {
                    localStorage.setItem('billingBannerPaidCycle', data.cycleKey);
                    banner.style.display = 'none';
                    // don't preventDefault — let the link open Railway in new tab
                };
            }

            document.getElementById('billingDismiss').onclick = () => {
                localStorage.setItem('billingBannerDismissedDate', today);
                banner.style.display = 'none';
            };
        } catch (e) {
            console.warn('loadBillingBanner failed:', e.message);
        }
    }

    // Load global auto-send toggles (form auto-reply + birthday auto-send)
    async function loadAutoToggles() {
        try {
            const result = await apiCall('/admin/settings/auto-toggles');
            if (result && result.success) {
                const formEl = document.getElementById('formAutoReplyToggle');
                const bdEl = document.getElementById('birthdayAutoSendGlobal');
                if (formEl) formEl.checked = result.data.form_autoreply_enabled !== false;
                if (bdEl) bdEl.checked = result.data.birthday_auto_send !== false;
            }
        } catch (e) {
            console.warn('loadAutoToggles failed:', e.message);
        }
    }

    window.saveAutoToggle = async function(key, enabled) {
        const result = await apiCall('/admin/settings/auto-toggles', {
            method: 'POST',
            body: JSON.stringify({ key, enabled })
        });
        if (!result || !result.success) {
            alert('Gagal menyimpan pengaturan. Coba lagi.');
            // Revert the UI
            loadAutoToggles();
        }
    };

    // ============================================
    // REALTIME (Option C): SSE from backend (which relays Supabase Postgres
    // changes). On any watched-table change, re-fetch the active view. Debounced
    // so bursts coalesce → ~1-1.5s perceived realtime. Cookie auth via
    // withCredentials. If the stream is unavailable, manual refresh still works.
    // ============================================
    let _rtStarted = false;
    let _rtDebounce = null;
    function startRealtimeStream() {
        if (_rtStarted) return;
        _rtStarted = true;
        try {
            const es = new EventSource(`${API_URL}/admin/stream`, { withCredentials: true });
            es.onmessage = (e) => {
                let msg = {};
                try { msg = JSON.parse(e.data || '{}'); } catch (_) { return; }
                if (!msg || msg.table === '_ping') return;   // ignore keep-alive
                clearTimeout(_rtDebounce);
                _rtDebounce = setTimeout(realtimeRefresh, 600);
            };
            es.onerror = () => { /* browser auto-reconnects (uses `retry` hint) */ };
        } catch (err) {
            console.warn('Realtime stream unavailable:', err.message);
        }
    }
    async function realtimeRefresh() {
        try {
            const activePage = document.querySelector('.nav-item.active');
            const page = activePage ? activePage.dataset.page : 'dashboard';
            if (typeof pipelineCache !== 'undefined') pipelineCache.clear();
            await loadDashboard();
            if (page === 'customers') await loadCustomers();
            else if (page === 'analytics') loadAnalytics();
            else if (page === 'birthday') loadBirthdayPage();
            else if (page === 'waconnect') { loadWAStatus(); loadFailedWA(); }
            else if (page === 'messages') await loadMessages();
        } catch (_) { /* silent — next event will retry */ }
    }

    async function loadDashboard() {
        try {
            console.log('📊 Loading dashboard stats...');

            // Load global toggles (non-blocking)
            loadAutoToggles();

            // Railway billing reminder banner — fires only on H-3..H+2 (else no-op).
            loadBillingBanner();
            // Monthly backup reminder — fires when last_backup_at > 30 days ago.
            loadBackupBanner();

            // Start realtime stream once (we're authenticated here). Safe no-op if
            // backend realtime is disabled — falls back to manual refresh.
            startRealtimeStream();

            // Load statistics
            const stats = await apiCall('/admin/stats');
            
            if (stats && stats.success) {
                console.log('✅ Stats loaded:', stats.data);
                document.getElementById('totalCustomers').textContent = stats.data.total_customers || 0;
                document.getElementById('fromInstagram').textContent = stats.data.from_instagram || 0;
                document.getElementById('fromWebsite').textContent = stats.data.from_website || 0;
                document.getElementById('newCustomers').textContent = stats.data.new_customers || 0;
                document.getElementById('contactedCustomers').textContent = stats.data.contacted_customers || 0;
                document.getElementById('followupCustomers').textContent = stats.data.followup_customers || 0;
                document.getElementById('completedCustomers').textContent = stats.data.completed_customers || 0;
                document.getElementById('inactiveCustomers').textContent = stats.data.inactive_customers || 0;

                // Source stats
                document.getElementById('fromFacebook').textContent = stats.data.from_facebook || 0;
                document.getElementById('fromTikTok').textContent = stats.data.from_tiktok || 0;
                document.getElementById('fromFriends').textContent = stats.data.from_friends || 0;
                document.getElementById('fromOthers').textContent = stats.data.from_others || 0;

                // Pipeline stats
                const d = stats.data;
                const formatRp = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val || 0);
                const bulanNow = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: TIMEZONE });

                document.getElementById('pipelinePeriod').textContent = bulanNow;
                document.getElementById('pipelineActive').textContent = d.pipeline_active || 0;
                document.getElementById('pipelineSuccess').textContent = d.pipeline_success || 0;
                document.getElementById('totalOmzet').textContent = formatRp(d.total_omzet);
                document.getElementById('omzetBulanIni').textContent = formatRp(d.omzet_bulan_ini);

                // Compare helper
                function compareHTML(cur, prev, isRp) {
                    cur = Number(cur) || 0;
                    prev = Number(prev) || 0;
                    if (prev === 0 && cur === 0) return '';
                    if (prev === 0) return `<span style="color:#4ADE80;">▲ Baru bulan ini</span>`;
                    const diff = cur - prev;
                    const pct = ((diff) / prev * 100).toFixed(1);
                    const valStr = isRp ? formatRp(Math.abs(diff)) : Math.abs(diff);
                    if (diff > 0) return `<span style="color:#4ADE80;">▲ +${pct}% (+${valStr})</span>`;
                    if (diff < 0) return `<span style="color:#FCA5A5;">▼ ${pct}% (${isRp ? '-' + formatRp(Math.abs(diff)) : diff})</span>`;
                    return `<span style="opacity:0.6;">— Sama</span>`;
                }

                // Pipeline Success compare
                const successIni = Number(d.success_bulan_ini) || 0;
                const successLalu = Number(d.success_bulan_lalu) || 0;
                document.getElementById('pipelineSuccessCompare').innerHTML =
                    `Bulan ini: <strong>${successIni}</strong> · Bulan lalu: ${successLalu}<br>${compareHTML(successIni, successLalu, false)}`;

                // Active change
                document.getElementById('pipelineActiveChange').innerHTML = compareHTML(d.active_bulan_ini, d.active_bulan_lalu, false);

                // Active breakdown
                document.getElementById('pipelineActiveDetail').innerHTML =
                    `🔵 New: ${d.status_new || 0}<br>🟡 Contacted: ${d.status_contacted || 0}<br>🟠 Follow Up: ${d.status_follow_up || 0}`;

                // Omzet compare
                const omzetIni = Number(d.omzet_bulan_ini) || 0;
                const omzetLalu = Number(d.omzet_bulan_lalu) || 0;
                document.getElementById('omzetCompare').innerHTML =
                    `Bulan lalu: ${formatRp(omzetLalu)}<br>${compareHTML(omzetIni, omzetLalu, true)}`;

                // Conversion rate
                const totalAll = Number(d.total_customers) || 0;
                const successAll = Number(d.pipeline_success) || 0;
                const rate = totalAll > 0 ? (successAll / totalAll * 100).toFixed(1) : 0;
                document.getElementById('conversionRate').textContent = `${rate}%`;
                document.getElementById('conversionBar').style.width = `${Math.min(rate, 100)}%`;
            } else {
                console.warn('⚠️ Failed to load stats');
            }

            // Load today's customers
            console.log('📊 Loading today customers...');
            const customers = await apiCall('/admin/customers');

            if (customers && customers.success) {
                const today = toWITADate(new Date());
                dashTodayCustomers = customers.data.filter(c => {
                    const refDate = customerActivityDate(c);
                    return refDate && toWITADate(refDate) === today;
                });
                console.log(`✅ Loaded ${dashTodayCustomers.length} customers today`);
                displayRecentCustomers();
            } else {
                document.getElementById('recentCustomers').innerHTML = '<div class="no-data">Belum ada customer</div>';
            }
        } catch (error) {
            console.error('❌ Load dashboard error:', error);
            document.getElementById('recentCustomers').innerHTML = '<div class="no-data">Gagal memuat data</div>';
        }
    }

    let dashTodayCustomers = [];
    let dashActiveTab = 'Belanja';

    window.switchDashTab = function(tab) {
        dashActiveTab = tab;
        const tabBelanja = document.getElementById('dashTabBelanja');
        const tabChatOnly = document.getElementById('dashTabChatOnly');
        if (tab === 'Belanja') {
            tabBelanja.style.borderBottomColor = '#B91C1C';
            tabBelanja.style.color = '#B91C1C';
            tabChatOnly.style.borderBottomColor = 'transparent';
            tabChatOnly.style.color = '#8C8078';
        } else {
            tabChatOnly.style.borderBottomColor = '#B91C1C';
            tabChatOnly.style.color = '#B91C1C';
            tabBelanja.style.borderBottomColor = 'transparent';
            tabBelanja.style.color = '#8C8078';
        }
        displayRecentCustomers();
    };

    function displayRecentCustomers() {
        const container = document.getElementById('recentCustomers');
        const customers = dashTodayCustomers.filter(c => (c.tipe || 'Belanja') === dashActiveTab);

        if (customers.length === 0) {
            container.innerHTML = '<div class="no-data">Belum ada customer hari ini</div>';
            return;
        }

        const isBelanja = dashActiveTab === 'Belanja';
        let html = `<table><thead><tr>
            <th>Nama</th>
            <th>WhatsApp</th>`;
        if (isBelanja) {
            html += `<th>Sales</th><th>Produk</th><th>Harga</th>`;
        } else {
            html += `<th>Catatan</th>`;
        }
        html += `<th>Source</th><th>Status</th><th>Jam</th><th>Aksi</th>
            </tr></thead><tbody>`;

        customers.forEach(customer => {
            const time = new Date(customerActivityDate(customer)).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit', timeZone: TIMEZONE});
            const sourceClass = String(customer.source || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
            const statusClass = String(customer.status || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');

            html += `<tr>
                <td>${esc(customer.nama_lengkap)}</td>
                <td style="white-space:nowrap;">${esc(customer.whatsapp)} <a href="https://wa.me/${esc(customer.whatsapp)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;background:#25D366;color:#fff;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:600;text-decoration:none;vertical-align:middle;margin-left:4px;">WA</a></td>`;

            if (isBelanja) {
                const produk = customer.merk_unit && customer.tipe_unit
                    ? `${esc(customer.merk_unit)} ${esc(customer.tipe_unit)}` : '-';
                const harga = customer.harga
                    ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(customer.harga) : '-';
                html += `<td>${esc(customer.nama_sales || '-')}</td>
                    <td>${produk}</td>
                    <td>${harga}</td>`;
            } else {
                html += `<td>${esc(customer.catatan || '-')}</td>`;
            }

            html += `<td><span class="badge ${sourceClass}">${esc(customer.source)}</span></td>
                <td><span class="badge ${statusClass}">${esc(customer.status)}</span></td>
                <td>${time}</td>
                <td><button class="btn-small" data-cid="${customer.id}" onclick="viewCustomer(${customer.id})" style="cursor:pointer;">Detail</button></td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ============================================
    // CUSTOMERS PAGE
    // ============================================

    async function loadCustomers() {
        const container = document.getElementById('customersTable');
        container.innerHTML = '<div class="loading">Loading...</div>';

        const result = await apiCall('/admin/customers');

        if (result && result.success) {
            allCustomers = result.data;
            applyFilters();
        } else {
            container.innerHTML = '<div class="no-data">Gagal memuat data</div>';
        }
    }

    window.refreshCustomers = async function() {
        await loadCustomers();
    };

    window.refreshDashboard = async function() {
        if (typeof pipelineCache !== 'undefined') pipelineCache.clear();
        await loadDashboard();
    };

    window.refreshAll = async function() {
        const btn = document.getElementById('refreshAllBtn');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Loading...';
        btn.disabled = true;

        try {
            // Cari halaman yang aktif
            const activePage = document.querySelector('.nav-item.active');
            const page = activePage ? activePage.dataset.page : 'dashboard';

            // Refresh semua data inti
            if (typeof pipelineCache !== 'undefined') pipelineCache.clear();
            await loadDashboard();
            loadCleanupBanner();
            checkWADisconnectBanner();

            // Refresh halaman yang sedang aktif
            if (page === 'customers') await loadCustomers();
            else if (page === 'analytics') loadAnalytics();
            else if (page === 'birthday') loadBirthdayPage();
            else if (page === 'waconnect') { loadWAStatus(); loadWAAutoReply(); loadFailedWA(); }
            else if (page === 'broadcast') { loadDailySentCount(); const s = await apiCall('/admin/broadcast/status'); if (s && s.status) renderBroadcastStatus(s.status); }
            else if (page === 'messages') { await loadMessages(); loadCleanupStatus(); }
        } catch (e) {
            console.error('Refresh error:', e);
        }

        btn.innerHTML = originalHTML;
        btn.disabled = false;
    };

    let activeTab = 'Belanja';
    let currentPage = 1;
    const rowsPerPage = 15;
    let filteredCustomers = [];

    let detailCustomerDraft = null;
    let detailInfoEditMode = false;
    let currentDetailCustomer = null;

    window.switchCustomerTab = function(tab) {
        activeTab = tab;
        currentPage = 1;
        const tabBelanja = document.getElementById('tabBelanja');
        const tabChatOnly = document.getElementById('tabChatOnly');
        if (tab === 'Belanja') {
            tabBelanja.style.borderBottomColor = '#B91C1C';
            tabBelanja.style.color = '#B91C1C';
            tabChatOnly.style.borderBottomColor = 'transparent';
            tabChatOnly.style.color = '#8C8078';
        } else {
            tabChatOnly.style.borderBottomColor = '#B91C1C';
            tabChatOnly.style.color = '#B91C1C';
            tabBelanja.style.borderBottomColor = 'transparent';
            tabBelanja.style.color = '#8C8078';
        }
        applyFilters();
    };

    window.goToPage = function(page) {
        currentPage = page;
        displayCustomers(filteredCustomers);
    };

    function displayCustomers(customers) {
        const container = document.getElementById('customersTable');
        filteredCustomers = customers;

        if (customers.length === 0) {
            container.innerHTML = '<div class="no-data">Belum ada customer</div>';
            return;
        }

        const totalPages = Math.ceil(customers.length / rowsPerPage);
        if (currentPage > totalPages) currentPage = totalPages;
        const start = (currentPage - 1) * rowsPerPage;
        const end = start + rowsPerPage;
        const pageData = customers.slice(start, end);
        const isBelanja = activeTab === 'Belanja';

        // Pagination info
        let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:13px;color:#8C8078;">
            <span>Menampilkan ${start + 1}–${Math.min(end, customers.length)} dari <strong>${customers.length}</strong> customer</span>
        </div>`;

        html += `<table><thead><tr>
            <th>No</th>
            <th>Nama</th>
            <th>WhatsApp</th>`;
        if (isBelanja) {
            html += `<th>Sales</th><th>Produk</th><th>Harga</th><th>Qty</th><th>Metode Pembayaran</th>
            <th>Source</th><th>Status</th><th>WA</th>`;
        } else {
            html += `<th>Catatan</th>`;
        }
        html += `<th>Tanggal</th><th>Aksi</th>
            </tr></thead><tbody>`;

        pageData.forEach((customer, index) => {
            const date = formatTanggal(customer.created_at);
            const sourceClass = String(customer.source || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
            const statusClass = String(customer.status || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');

            const pCount = customer.purchase_count || 0;
            const repeatBadge = pCount > 1 ? ` <span style="background:#B91C1C;color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;">${pCount}x</span>` : '';

            // WA sent indicator
            let waIcon = '<span style="color:#DC2626;" title="WA gagal / belum terkirim">&#10007;</span>';
            if (customer.wa_sent === true) {
                waIcon = '<span style="color:#25D366;" title="WA terkirim">&#10003;</span>';
            } else if (customer.wa_sent === null) {
                waIcon = '<span style="color:#6B7280;" title="Nomor tidak terdaftar">__</span>';
            }

            html += `<tr>
                <td>${start + index + 1}</td>
                <td>${esc(customer.nama_lengkap)}${repeatBadge}</td>
                <td style="white-space:nowrap;">${esc(customer.whatsapp)} <a href="https://wa.me/${esc(customer.whatsapp)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;background:#25D366;color:#fff;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:600;text-decoration:none;vertical-align:middle;margin-left:4px;" title="Chat WhatsApp">WA</a></td>`;

            if (isBelanja) {
                const produk = customer.merk_unit && customer.tipe_unit
                    ? `${esc(customer.merk_unit)} ${esc(customer.tipe_unit)}` : '-';
                const harga = customer.harga
                    ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(customer.harga) : '-';
                html += `<td>${esc(customer.nama_sales || '-')}</td>
                    <td>${produk}</td>
                    <td>${harga}</td>
                    <td style="text-align:center;">${customer.qty || 1}</td>
                    <td>${esc(customer.metode_pembayaran || '-')}</td>`;
                html += `<td><span class="badge ${sourceClass}">${esc(customer.source)}</span></td>
                    <td><span class="badge ${statusClass}">${esc(customer.status)}</span></td>
                    <td style="text-align:center;font-size:18px;">${waIcon}</td>`;
            } else {
                html += `<td><div style="display:flex;align-items:center;gap:6px;">
                    <input type="text" id="catatan_${customer.id}" value="${esc(customer.catatan || '')}" placeholder="Tulis catatan..." style="border:1px solid #EDE8E3;padding:6px 10px;border-radius:6px;font-size:13px;flex:1;min-width:160px;background:#FAFAF8;" onkeydown="if(event.key==='Enter'){saveCatatan(${customer.id}, this.value);}">
                    <button class="btn-small" onclick="saveCatatan(${customer.id}, document.getElementById('catatan_${customer.id}').value)" style="padding:5px 10px;font-size:11px;white-space:nowrap;background:#DCFCE7;color:#16A34A;border:1px solid #BBF7D0;cursor:pointer;">Save</button>
                </div></td>`;
            }

            html += `<td>${date}</td>
                <td><div class="table-actions" style="display:flex;gap:4px;">
                    <button class="btn-small" data-cid="${customer.id}" onclick="viewCustomer(${customer.id})" style="cursor:pointer;">Detail</button>
                    <button class="btn-small" onclick="deleteCustomer(${customer.id}, '${esc(customer.nama_lengkap)}')" style="cursor:pointer;background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;">Hapus</button>
                </div></td>
            </tr>`;
        });

        html += '</tbody></table>';

        // Pagination controls
        if (totalPages > 1) {
            html += `<div style="display:flex;justify-content:center;align-items:center;gap:6px;margin-top:16px;flex-wrap:wrap;">`;

            // Previous
            html += `<button onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}
                style="padding:6px 12px;border:1px solid #EDE8E3;border-radius:6px;background:${currentPage === 1 ? '#F5F3F0' : '#fff'};color:${currentPage === 1 ? '#ccc' : '#5C534B'};cursor:${currentPage === 1 ? 'default' : 'pointer'};font-size:13px;">‹ Prev</button>`;

            // Page numbers
            const maxVisible = 5;
            let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

            if (startPage > 1) {
                html += `<button onclick="goToPage(1)" style="padding:6px 10px;border:1px solid #EDE8E3;border-radius:6px;background:#fff;color:#5C534B;cursor:pointer;font-size:13px;">1</button>`;
                if (startPage > 2) html += `<span style="color:#ccc;font-size:13px;">...</span>`;
            }

            for (let i = startPage; i <= endPage; i++) {
                const isActive = i === currentPage;
                html += `<button onclick="goToPage(${i})" style="padding:6px 10px;border:1px solid ${isActive ? '#B91C1C' : '#EDE8E3'};border-radius:6px;background:${isActive ? '#B91C1C' : '#fff'};color:${isActive ? '#fff' : '#5C534B'};cursor:pointer;font-size:13px;font-weight:${isActive ? '600' : '400'};">${i}</button>`;
            }

            if (endPage < totalPages) {
                if (endPage < totalPages - 1) html += `<span style="color:#ccc;font-size:13px;">...</span>`;
                html += `<button onclick="goToPage(${totalPages})" style="padding:6px 10px;border:1px solid #EDE8E3;border-radius:6px;background:#fff;color:#5C534B;cursor:pointer;font-size:13px;">${totalPages}</button>`;
            }

            // Next
            html += `<button onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}
                style="padding:6px 12px;border:1px solid #EDE8E3;border-radius:6px;background:${currentPage === totalPages ? '#F5F3F0' : '#fff'};color:${currentPage === totalPages ? '#ccc' : '#5C534B'};cursor:${currentPage === totalPages ? 'default' : 'pointer'};font-size:13px;">Next ›</button>`;

            html += `</div>`;
        }

        container.innerHTML = html;
    }

    // Combined filter function
    function applyFilters() {
        const search = document.getElementById('searchCustomer').value.toLowerCase().trim();
        const source = document.getElementById('filterSource').value;
        const status = document.getElementById('filterStatus').value;
        const merk = document.getElementById('filterMerk').value;
        const sortWaktu = document.getElementById('sortWaktu').value;
        const sortHarga = document.getElementById('sortHarga').value;
        const dateFrom = document.getElementById('filterDateFrom').value;
        const dateTo = document.getElementById('filterDateTo').value;

        // Filter by active tab
        let filtered = allCustomers.filter(c => (c.tipe || 'Belanja') === activeTab);
        if (search) filtered = filtered.filter(c => c.nama_lengkap.toLowerCase().includes(search) || (c.whatsapp && c.whatsapp.includes(search)));
        if (source) filtered = filtered.filter(c => c.source === source);
        if (status) filtered = filtered.filter(c => c.status === status);
        if (merk) {
            const target = merk.toLowerCase();
            filtered = filtered.filter(c => {
                // cek purchase utama (root)
                const rootMatch = 
                (c.merk_unit || '').toLowerCase().includes(target) ||
                (c.tipe_unit || '').toLowerCase().includes(target);
                if (rootMatch) return true;

                // cek semua riwayat pembelian
                const purchases = c.purchases || [];
                return purchases.some(p => 
                    (p. merk_unit || '').toLowerCase().includes(target) ||
                    (p.tipe_unit || '').toLowerCase().includes(target)
                );
            });
        }
                    
        if (dateFrom) filtered = filtered.filter(c => new Date(customerActivityDate(c)) >= new Date(dateFrom));
        if (dateTo) {
            const to = new Date(dateTo);
            to.setDate(to.getDate() + 1);
            filtered = filtered.filter(c => new Date(customerActivityDate(c)) < to);
        }

        // Sorting — harga takes precedence if set, else waktu
        if (sortHarga === 'cheapest') {
            filtered.sort((a, b) => (Number(a.harga) || 0) - (Number(b.harga) || 0));
        } else if (sortHarga === 'expensive') {
            filtered.sort((a, b) => (Number(b.harga) || 0) - (Number(a.harga) || 0));
        } else if (sortWaktu === 'newest') {
            filtered.sort((a, b) => new Date(customerActivityDate(b)) - new Date(customerActivityDate(a)));
        } else if (sortWaktu === 'oldest') {
            filtered.sort((a, b) => new Date(customerActivityDate(a)) - new Date(customerActivityDate(b)));
        }

        currentPage = 1;
        displayCustomers(filtered);
    }

    document.getElementById('searchCustomer').addEventListener('input', applyFilters);
    document.getElementById('filterSource').addEventListener('change', applyFilters);
    document.getElementById('filterStatus').addEventListener('change', applyFilters);
    document.getElementById('filterMerk').addEventListener('change', applyFilters);
    // Sort waktu & harga: only one active at a time — selecting one resets the other
    document.getElementById('sortWaktu').addEventListener('change', () => {
        if (document.getElementById('sortWaktu').value) {
            document.getElementById('sortHarga').value = '';
        }
        applyFilters();
    });
    document.getElementById('sortHarga').addEventListener('change', () => {
        if (document.getElementById('sortHarga').value) {
            document.getElementById('sortWaktu').value = '';
        }
        applyFilters();
    });
    document.getElementById('filterDateFrom').addEventListener('change', applyFilters);
    document.getElementById('filterDateTo').addEventListener('change', applyFilters);

    // Status is now fully automatic — no manual update needed

    async function fetchPurchaseMetadata() {
        try {
            const res = await apiCall('/admin/purchases/metadata');
            if (res && res.success && res.data) {
                purchaseMetadata = res.data;
            }
        } catch (e) { /* non-critical, keep empty arrays */ }
    }

    // View customer detail — with loading state & error feedback
    window.viewCustomer = async function(customerId) {
        console.log(`👁️ Viewing customer ${customerId}`);
        if (!customerId) { alert('ID customer tidak valid'); return; }

        // Show loading in modal immediately
        const modal = document.getElementById('customerModal');
        const detail = document.getElementById('customerDetail');
        detail.innerHTML = '<div class="loading">Memuat data customer...</div>';
        modal.classList.add('show');

        // Refresh metadata each time modal opens so dropdowns stay current
        fetchPurchaseMetadata();

        try {
            const result = await apiCall(`/admin/customers/${customerId}`);
            if (result && result.success) {
                showCustomerDetail(result.data);
            } else {
                detail.innerHTML = '<div class="no-data">Gagal memuat data customer</div>';
            }
        } catch (err) {
            console.error('viewCustomer error:', err);
            detail.innerHTML = '<div class="no-data">Terjadi kesalahan saat memuat data</div>';
        }
    };

    // Event delegation for Detail buttons (backup for inline onclick)
    document.getElementById('customersTable').addEventListener('click', function(e) {
        const btn = e.target.closest('button.btn-small');
        if (btn && btn.textContent.trim() === 'Detail') {
            const row = btn.closest('tr');
            if (row) {
                const cid = btn.getAttribute('data-cid');
                if (cid) viewCustomer(Number(cid));
            }
        }
    });
    document.getElementById('recentCustomers').addEventListener('click', function(e) {
        const btn = e.target.closest('button.btn-small');
        if (btn && btn.textContent.trim() === 'Detail') {
            const cid = btn.getAttribute('data-cid');
            if (cid) viewCustomer(Number(cid));
        }
    });

    function showCustomerDetail(customer) {
        currentDetailCustomer = customer;
        detailInfoEditMode = false;
        renderCustomerDetailBody();
    }

    window.toggleDetailEditMode = function() {
        detailInfoEditMode = !detailInfoEditMode;
        renderCustomerDetailBody();
    }

    function renderCustomerDetailBody() {
        const customer = currentDetailCustomer;
        if (!customer) return;

        const modal = document.getElementById('customerModal');
        const detail = document.getElementById('customerDetail');
        const formatRpDetail = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val || 0);

        const date = formatWaktu(customer.created_at);
        const harga = customer.harga ? formatRpDetail(customer.harga) : '-';
        const tanggalLahir = customer.tanggal_lahir ? formatTanggal(customer.tanggal_lahir) : '-';
        const sourceClass = String(customer.source || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
        const statusClass = String(customer.status || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
        const purchaseCount = customer.purchase_count || 0;
        const editing = detailInfoEditMode;

        const statusColors = { 'New': '#D97706', 'Contacted': '#2563EB', 'Follow Up': '#9333EA', 'Completed': '#16A34A', 'Inactive': '#8C8078' };
        const statusColor = statusColors[customer.status] || '#5C534B';

        let fieldsHtml;
        if (editing) {
            fieldsHtml = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">
                <div class="detail-group">
                    <div class="detail-label">Nama Lengkap</div>
                    <div class="detail-value"><input id="detailNamaLengkap" type="text" value="${esc(customer.nama_lengkap)}" style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;" /></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">WhatsApp</div>
                    <div class="detail-value" style="display:flex;align-items:center;gap:8px;">
                        <input id="detailWhatsApp" type="text" value="${esc(customer.whatsapp)}" disabled style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;background:#F8FAFC;" />
                        <a href="https://wa.me/${esc(customer.whatsapp)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;background:#25D366;color:#fff;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:600;text-decoration:none;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">Chat</a>
                    </div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Tanggal Lahir</div>
                    <div class="detail-value"><input id="detailTanggalLahir" type="date" value="${customer.tanggal_lahir ? toWITADate(customer.tanggal_lahir) : ''}" style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;" /></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Alamat</div>
                    <div class="detail-value"><textarea id="detailAlamat" rows="2" style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;resize:vertical;">${esc(customer.alamat || '')}</textarea></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Produk</div>
                    <div class="detail-value"><input id="detailMerkUnit" type="text" value="${esc(customer.merk_unit || '')}" placeholder="Merk" style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;" /></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Tipe</div>
                    <div class="detail-value"><input id="detailTipeUnit" type="text" value="${esc(customer.tipe_unit || '')}" placeholder="Tipe" style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;" /></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Harga</div>
                    <div class="detail-value"><input id="detailHarga" type="number" step="0.01" value="${customer.harga || ''}" style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;" /></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Qty</div>
                    <div class="detail-value"><input id="detailQty" type="number" min="1" value="${customer.qty || 1}" style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;" /></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Metode Pembayaran</div>
                    <div class="detail-value"><input id="detailMetodePembayaran" type="text" value="${esc(customer.metode_pembayaran || '')}" style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;" /></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Sales</div>
                    <div class="detail-value"><input id="detailNamaSales" type="text" value="${esc(customer.nama_sales || '')}" style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;" /></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Tahu dari</div>
                    <div class="detail-value"><input id="detailTahuDari" type="text" value="${esc(customer.tahu_dari || '')}" style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;" /></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Source</div>
                    <div class="detail-value"><input id="detailSource" type="text" value="${esc(customer.source || '')}" style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;" /></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Status</div>
                    <div class="detail-value">
                        <select id="detailStatus" class="status-select ${statusClass}" style="width:100%;padding:10px;border:1px solid #E5E7EB;border-radius:10px;font-size:14px;">
                            ${['New','Contacted','Follow Up','Completed','Inactive'].map(s =>
                                `<option value="${s}" ${customer.status === s ? 'selected' : ''}>${s}</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Tipe Customer</div>
                    <div class="detail-value"><span style="background:${customer.tipe === 'Chat Only' ? 'rgba(37,99,235,0.1);color:#2563EB' : 'rgba(185,28,28,0.08);color:#B91C1C'};padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;">${customer.tipe || 'Belanja'}</span></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Total Pembelian</div>
                    <div class="detail-value" style="font-weight:600;color:#B91C1C;">${purchaseCount}x transaksi</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Terdaftar</div>
                    <div class="detail-value">${date}</div>
                </div>
            </div>
            <div style="margin-top:18px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
                <button id="detailInfoSaveButton" class="btn-small" onclick="saveCustomerInfo(${customer.id})" style="min-width:160px;background:linear-gradient(135deg,#B91C1C,#DC2626);color:#fff;border:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">Simpan Perubahan</button>
                <button class="btn-small" onclick="toggleDetailEditMode()" style="padding:10px 18px;border-radius:8px;font-size:13px;">Batal</button>
                <span id="detailInfoSaveFeedback" style="font-size:13px;color:#16A34A;"></span>
            </div>`;
        } else {
            fieldsHtml = `
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;">
                <button class="btn-small" onclick="toggleDetailEditMode()" style="background:#EEF2FF;color:#4F46E5;border:1px solid #C7D2FE;padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Edit Info
                </button>
                <button class="btn-small" onclick="deleteCustomer(${customer.id}, '${esc(customer.nama_lengkap)}')" style="background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;padding:7px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    Hapus
                </button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">
                <div class="detail-group">
                    <div class="detail-label">Nama Lengkap</div>
                    <div class="detail-value" style="font-size:14px;font-weight:600;color:#1A1412;padding:10px 0;">${esc(customer.nama_lengkap)}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">WhatsApp</div>
                    <div class="detail-value" style="display:flex;align-items:center;gap:8px;padding:10px 0;">
                        <span style="font-size:14px;color:#1A1412;">${esc(customer.whatsapp)}</span>
                        <a href="https://wa.me/${esc(customer.whatsapp)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;background:#25D366;color:#fff;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:600;text-decoration:none;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">Chat</a>
                    </div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Tanggal Lahir</div>
                    <div class="detail-value" style="font-size:14px;color:#1A1412;padding:10px 0;">${tanggalLahir}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Alamat</div>
                    <div class="detail-value" style="font-size:14px;color:#1A1412;padding:10px 0;">${esc(customer.alamat || '-')}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Produk</div>
                    <div class="detail-value" style="font-size:14px;color:#1A1412;padding:10px 0;">${esc(customer.merk_unit || '-')}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Tipe</div>
                    <div class="detail-value" style="font-size:14px;color:#1A1412;padding:10px 0;">${esc(customer.tipe_unit || '-')}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Harga</div>
                    <div class="detail-value" style="font-size:14px;font-weight:600;color:#1A1412;padding:10px 0;">${harga}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Qty</div>
                    <div class="detail-value" style="font-size:14px;color:#1A1412;padding:10px 0;">${customer.qty || 1}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Metode Pembayaran</div>
                    <div class="detail-value" style="font-size:14px;color:#1A1412;padding:10px 0;">${esc(customer.metode_pembayaran || '-')}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Sales</div>
                    <div class="detail-value" style="font-size:14px;color:#1A1412;padding:10px 0;">${esc(customer.nama_sales || '-')}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Tahu dari</div>
                    <div class="detail-value" style="font-size:14px;color:#1A1412;padding:10px 0;">${esc(customer.tahu_dari || '-')}</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Source</div>
                    <div class="detail-value" style="padding:10px 0;"><span class="badge ${sourceClass}">${esc(customer.source || '-')}</span></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Status</div>
                    <div class="detail-value" style="padding:10px 0;"><span class="badge ${statusClass}" style="color:${statusColor};font-weight:600;">${esc(customer.status || '-')}</span></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Tipe Customer</div>
                    <div class="detail-value" style="padding:10px 0;"><span style="background:${customer.tipe === 'Chat Only' ? 'rgba(37,99,235,0.1);color:#2563EB' : 'rgba(185,28,28,0.08);color:#B91C1C'};padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;">${customer.tipe || 'Belanja'}</span></div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Total Pembelian</div>
                    <div class="detail-value" style="font-weight:600;color:#B91C1C;padding:10px 0;">${purchaseCount}x transaksi</div>
                </div>
                <div class="detail-group">
                    <div class="detail-label">Terdaftar</div>
                    <div class="detail-value" style="font-size:14px;color:#1A1412;padding:10px 0;">${date}</div>
                </div>
            </div>`;
        }

        detail.innerHTML = `
            ${fieldsHtml}
            <!-- Status Legend -->
            <div style="margin-top:16px;padding:12px 16px;background:#FAFAF8;border:1px solid #EDE8E3;border-radius:8px;">
                <div style="font-size:11px;font-weight:600;color:#8C8078;margin-bottom:6px;">KETERANGAN STATUS:</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px 16px;font-size:11px;color:#5C534B;">
                    <span><strong style="color:#D97706;">New</strong> = Baru masuk</span>
                    <span><strong style="color:#2563EB;">Contacted</strong> = Sudah dihubungi</span>
                    <span><strong style="color:#9333EA;">Follow Up</strong> = Perlu ditindaklanjuti</span>
                    <span><strong style="color:#16A34A;">Completed</strong> = Deal/selesai</span>
                    <span><strong style="color:#8C8078;">Inactive</strong> = Tidak aktif</span>
                </div>
            </div>
            <div id="purchaseEditor"></div>
        `;

        modal.classList.add('show');
        renderPurchaseEditor(customer);
    }

    function renderPurchaseEditor(customer) {
        if (customer) {
            detailCustomerDraft = {
                id: customer.id,
                purchases: (customer.purchases || []).map(p => ({
                    id: p.id,
                    merk_unit: p.merk_unit || '',
                    tipe_unit: p.tipe_unit || '',
                    harga: p.harga || '',
                    qty: p.qty || 1,
                    nama_sales: p.nama_sales || '',
                    metode_pembayaran: p.metode_pembayaran || '',
                    source: p.source || '',
                    created_at: p.created_at || null,
                    deleted: false,
                    isEditing: false
                }))
            };
        }

        if (!detailCustomerDraft) return;

        const editor = document.getElementById('purchaseEditor');
        if (!editor) return;

        const fmtRp = v => { const n = Number(v); return (!n || isNaN(n)) ? '0' : new Intl.NumberFormat('id-ID').format(n); };
        const fmtDate = v => { if (!v) return '-'; try { return new Date(v).toLocaleDateString('id-ID', { timeZone: 'Asia/Makassar' }); } catch(e) { return '-'; } };
        const nonDeleted = detailCustomerDraft.purchases.filter(p => !p.deleted);
        const totalValue = nonDeleted.reduce((s, p) => s + (Number(p.harga) || 0) * (Number(p.qty) || 1), 0);
        const totalQty   = nonDeleted.reduce((s, p) => s + (Number(p.qty) || 1), 0);

        const summaryBox = nonDeleted.length > 0 ? `
            <div style="background:#FFF9E6;border:1px solid #F0E6C0;border-radius:10px;padding:14px 18px;margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="font-size:13px;font-weight:600;color:#1A1412;">Ringkasan Pembelian (${totalQty} unit total):</div>
                    <div style="font-size:13px;font-weight:700;color:#1A1412;">Total: Rp${fmtRp(totalValue)}</div>
                </div>
                ${nonDeleted.map(p => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-top:1px solid rgba(0,0,0,0.05);">
                        <span style="font-size:12px;color:#5C534B;">${fmtDate(p.created_at)}</span>
                        <span style="font-size:12px;color:#5C534B;">${esc(p.merk_unit || '')} ${esc(p.tipe_unit || '')}${p.metode_pembayaran ? ' · ' + esc(p.metode_pembayaran) : ''}</span>
                    </div>
                `).join('')}
            </div>` : '';

        const hasAnyEditing = detailCustomerDraft.purchases.some(p => !p.deleted && p.isEditing);

        let vi = 0;
        const rowsHtml = detailCustomerDraft.purchases.map((p, index) => {
            if (p.deleted) return '';
            vi++;
            const num = vi;

            if (p.isEditing) {
                return `
                    <tr data-purchase-id="${p.id || ''}" data-index="${index}">
                        <td colspan="8" style="padding:8px 0;border:none;">
                            <div style="border:2px solid #4F46E5;border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 0 0 3px rgba(79,70,229,0.08);">
                                <div style="background:linear-gradient(135deg,#EEF2FF 0%,#E0E7FF 100%);padding:8px 14px;border-bottom:1px solid #C7D2FE;">
                                    <span style="font-size:12px;font-weight:700;color:#4F46E5;">Edit Pembelian #${num}</span>
                                </div>
                                <div style="padding:12px 14px;">
                                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
                                        <div>
                                            <div style="font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;margin-bottom:3px;">Merk HP</div>
                                            ${(function(){
                                                const MERKS=['iPhone','Samsung','Xiaomi','Oppo','Tecno','Realme','Infinix','Nokia'];
                                                const cur=(p.merk_unit||'').trim();
                                                const curL=cur.toLowerCase();
                                                const match=MERKS.find(m=>m.toLowerCase()===curL);
                                                const extra=cur&&!match?'<option value="'+esc(cur)+'" selected>'+esc(cur)+'</option>':'';
                                                const opts=MERKS.map(m=>'<option value="'+esc(m)+'"'+(m.toLowerCase()===curL?' selected':'')+'>'+esc(m)+'</option>').join('');
                                                return '<select class="purchase-merk" style="width:100%;padding:7px 8px;border:1px solid #E5E7EB;border-radius:8px;font-size:13px;box-sizing:border-box;background:#fff;">'+extra+'<option value="">-- Pilih --</option>'+opts+'</select>';
                                            })()}
                                        </div>
                                        <div>
                                            <div style="font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;margin-bottom:3px;">Tipe HP</div>
                                            <input class="purchase-tipe" type="text" value="${esc(p.tipe_unit)}" placeholder="Tipe"
                                                   style="width:100%;padding:7px 8px;border:1px solid #E5E7EB;border-radius:8px;font-size:13px;box-sizing:border-box;"/>
                                        </div>
                                        <div>
                                            <div style="font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;margin-bottom:3px;">Qty</div>
                                            <input class="purchase-qty" type="number" min="1" value="${esc(p.qty)}"
                                                   style="width:100%;padding:7px 8px;border:1px solid #E5E7EB;border-radius:8px;font-size:13px;box-sizing:border-box;"/>
                                        </div>
                                        <div>
                                            <div style="font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;margin-bottom:3px;">Harga (Rp)</div>
                                            <input class="purchase-harga" type="number" step="0.01" value="${esc(p.harga)}" placeholder="0"
                                                   style="width:100%;padding:7px 8px;border:1px solid #E5E7EB;border-radius:8px;font-size:13px;box-sizing:border-box;"/>
                                        </div>
                                        <div>
                                            <div style="font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;margin-bottom:3px;">Sales</div>
                                            <input class="purchase-sales" type="text" value="${esc(p.nama_sales)}" placeholder="Nama Sales"
                                                   style="width:100%;padding:7px 8px;border:1px solid #E5E7EB;border-radius:8px;font-size:13px;box-sizing:border-box;"/>
                                        </div>
                                        <div>
                                            <div style="font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;margin-bottom:3px;">Pembayaran</div>
                                            ${(function(){
                                                const PAYS=['Paid Cash','Paid Credit - Akulaku','Paid Credit - Avanto','Paid Credit - FinancePlus','Paid Credit - Home Credit Indonesia','Paid Credit - Indodana','Paid Credit - KreditPlus','Paid Credit - Kredivo','Paid Credit - Shopeepay Later','Kartu Kredit','Kartu Debit'];
                                                const cur=(p.metode_pembayaran||'').trim();
                                                const curL=cur.toLowerCase();
                                                const match=PAYS.find(m=>m.toLowerCase()===curL);
                                                const extra=cur&&!match?'<option value="'+esc(cur)+'" selected>'+esc(cur)+'</option>':'';
                                                const opts=PAYS.map(m=>'<option value="'+esc(m)+'"'+(m.toLowerCase()===curL?' selected':'')+'>'+esc(m)+'</option>').join('');
                                                return '<select class="purchase-payment" style="width:100%;padding:7px 8px;border:1px solid #E5E7EB;border-radius:8px;font-size:13px;box-sizing:border-box;background:#fff;">'+extra+'<option value="">-- Pilih --</option>'+opts+'</select>';
                                            })()}
                                        </div>
                                    </div>
                                    <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:8px;border-top:1px solid #E5E7EB;">
                                        <button class="btn-small" onclick="togglePurchaseEdit(this)" type="button"
                                                style="background:#DCFCE7;color:#16A34A;border:1px solid #BBF7D0;font-size:12px;padding:5px 12px;border-radius:8px;">OK</button>
                                        <button class="btn-small" onclick="cancelPurchaseEdit(this)" type="button"
                                                style="background:#F3F4F6;color:#6B7280;border:1px solid #E5E7EB;font-size:12px;padding:5px 12px;border-radius:8px;">Batal</button>
                                        <button class="btn-small" onclick="deletePurchaseRow(this)" type="button"
                                                style="background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;font-size:12px;padding:5px 12px;border-radius:8px;">Hapus</button>
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>`;
            }

            const subtotal = (Number(p.harga) || 0) * (Number(p.qty) || 1);
            return `
                <tr data-purchase-id="${p.id || ''}" data-index="${index}" style="border-bottom:1px solid #EDE8E3;">
                    <td style="padding:10px 6px;font-size:12px;color:#5C534B;white-space:nowrap;">${fmtDate(p.created_at)}</td>
                    <td style="padding:10px 6px;font-size:12px;font-weight:700;color:#1A1412;">${esc(p.merk_unit || '-')}</td>
                    <td style="padding:10px 6px;font-size:12px;color:#374151;">${esc(p.tipe_unit || '-')}</td>
                    <td style="padding:10px 6px;font-size:12px;color:#374151;text-align:center;">${p.qty || 1}</td>
                    <td style="padding:10px 6px;font-size:12px;color:#374151;">Rp${fmtRp(p.harga)}</td>
                    <td style="padding:10px 6px;font-size:12px;font-weight:700;color:#B91C1C;">Rp${fmtRp(subtotal)}</td>
                    <td style="padding:10px 6px;font-size:12px;color:#374151;">${esc(p.nama_sales || '-')}</td>
                    <td style="padding:10px 4px;white-space:nowrap;">
                        <button class="btn-small" onclick="togglePurchaseEdit(this)" type="button"
                                style="background:#EEF2FF;color:#4F46E5;border:1px solid #C7D2FE;font-size:11px;padding:4px 8px;border-radius:6px;">Edit</button>
                        <button class="btn-small" onclick="deletePurchaseRow(this)" type="button"
                                style="background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;font-size:11px;padding:4px 8px;border-radius:6px;">Hapus</button>
                    </td>
                </tr>`;
        }).join('');

        const tableHeader = nonDeleted.length > 0 && !hasAnyEditing ? `
            <thead>
                <tr style="border-bottom:2px solid #1A1412;">
                    <th style="padding:8px 6px;font-size:10px;font-weight:700;color:#1A1412;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Tanggal</th>
                    <th style="padding:8px 6px;font-size:10px;font-weight:700;color:#1A1412;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Merk HP</th>
                    <th style="padding:8px 6px;font-size:10px;font-weight:700;color:#1A1412;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Tipe HP</th>
                    <th style="padding:8px 6px;font-size:10px;font-weight:700;color:#1A1412;text-transform:uppercase;letter-spacing:.04em;text-align:center;">Qty</th>
                    <th style="padding:8px 6px;font-size:10px;font-weight:700;color:#1A1412;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Harga Satuan</th>
                    <th style="padding:8px 6px;font-size:10px;font-weight:700;color:#1A1412;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Subtotal</th>
                    <th style="padding:8px 6px;font-size:10px;font-weight:700;color:#1A1412;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Sales</th>
                    <th style="padding:8px 6px;font-size:10px;font-weight:700;color:#1A1412;text-transform:uppercase;letter-spacing:.04em;text-align:left;">Aksi</th>
                </tr>
            </thead>` : '';

        editor.innerHTML = `
            <div style="margin-top:20px;padding-top:20px;border-top:2px solid #EDE8E3;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="font-size:15px;font-weight:700;color:#1A1412;">Riwayat Pembelian</span>
                        ${nonDeleted.length > 0 ? '<span style="background:#B91C1C;color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:12px;">' + nonDeleted.length + 'x transaksi</span>' : ''}
                    </div>
                    <button class="btn-small" onclick="addPurchaseRow()" type="button"
                            style="background:linear-gradient(135deg,#4F46E5,#6366F1);color:#fff;border:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;transition:opacity .18s;"
                            onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">+ Tambah Pembelian</button>
                </div>
                ${summaryBox}
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;min-width:600px;">
                        ${tableHeader}
                        <tbody id="purchaseEditorRows">
                            ${rowsHtml || '<tr><td colspan="8" style="padding:32px 0;text-align:center;color:#9CA3AF;font-size:13px;">Belum ada data pembelian.<br><span style="font-size:12px;">Klik <strong>+ Tambah Pembelian</strong> untuk mulai.</span></td></tr>'}
                        </tbody>
                    </table>
                </div>
                <div style="margin-top:16px;display:flex;gap:12px;align-items:center;">
                    <button id="purchaseSaveButton" class="btn-small" onclick="savePurchases(${detailCustomerDraft?.id})" type="button"
                            style="background:linear-gradient(135deg,#B91C1C,#DC2626);color:#fff;border:none;min-width:210px;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .18s;"
                            onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">Simpan Riwayat Pembelian</button>
                    <span id="purchaseSaveFeedback" style="font-size:13px;color:#16A34A;"></span>
                </div>
            </div>
        `;
    }

    window.addPurchaseRow = function() {
        if (!detailCustomerDraft) return;
        detailCustomerDraft.purchases.push({
            id: null,
            merk_unit: '',
            tipe_unit: '',
            harga: '',
            qty: 1,
            nama_sales: '',
            metode_pembayaran: '',
            source: '',
            deleted: false,
            isEditing: true
        });
        renderPurchaseEditor();
    }

    window.togglePurchaseEdit = function(button) {
        const row = button.closest('tr');
        if (!row) return;
        const index = Number(row.dataset.index);
        const purchase = detailCustomerDraft?.purchases[index];
        if (!purchase) return;
        if (purchase.isEditing) {
            const values = getPurchaseRowValues(row, purchase);
            Object.assign(purchase, values);
            purchase.isEditing = false;
        } else {
            purchase.isEditing = true;
        }
        renderPurchaseEditor();
    }

    window.cancelPurchaseEdit = function(button) {
        const row = button.closest('tr');
        if (!row) return;
        const index = Number(row.dataset.index);
        const purchase = detailCustomerDraft?.purchases[index];
        if (!purchase) return;
        if (!purchase.id) {
            detailCustomerDraft.purchases.splice(index, 1);
        } else {
            purchase.isEditing = false;
        }
        renderPurchaseEditor();
    }

    window.deletePurchaseRow = function(button) {
        const row = button.closest('tr');
        if (!row) return;
        const index = Number(row.dataset.index);
        const purchase = detailCustomerDraft?.purchases[index];
        if (!purchase) return;
        if (purchase.id) {
            purchase.deleted = true;
        } else {
            detailCustomerDraft.purchases.splice(index, 1);
        }
        renderPurchaseEditor();
    }

    function getPurchaseRowValues(row, item) {
        if (!row) return item;
        return {
            merk_unit: row.querySelector('.purchase-merk')?.value.trim() || item.merk_unit || null,
            tipe_unit: row.querySelector('.purchase-tipe')?.value.trim() || item.tipe_unit || null,
            harga: row.querySelector('.purchase-harga')?.value || item.harga || null,
            qty: row.querySelector('.purchase-qty')?.value || item.qty || 1,
            nama_sales: row.querySelector('.purchase-sales')?.value.trim() || item.nama_sales || null,
            metode_pembayaran: row.querySelector('.purchase-payment')?.value.trim() || item.metode_pembayaran || null,
            source: item.source || ''
        };
    }

    window.deleteCustomer = async function(customerId, namaLengkap) {
        if (!customerId) return;

        // Tentukan alur berdasarkan jumlah transaksi: 0–1 transaksi → hapus
        // seluruh customer; >1 transaksi → tampilkan pemilih transaksi mana
        // yang ingin dihapus (customer tetap ada, kecuali semua dipilih).
        let purchases = [];
        try {
            const res = await apiCall(`/admin/customers/${customerId}`);
            if (res && res.success) purchases = res.data?.purchases || [];
        } catch (error) {
            console.warn('deleteCustomer: gagal ambil detail, fallback hapus penuh:', error);
        }

        if (purchases.length <= 1) {
            return confirmDeleteWholeCustomer(customerId, namaLengkap);
        }
        openDeleteTransactionPicker(customerId, namaLengkap, purchases);
    };

    // Hapus seluruh customer + semua data terkait. Antrian/queue (whatsapp_logs)
    // dibersihkan di backend dalam satu transaksi dengan delete customer.
    async function confirmDeleteWholeCustomer(customerId, namaLengkap) {
        if (!confirm(`Yakin ingin menghapus customer "${namaLengkap}"?\n\nSemua data terkait (pembelian, pesan, ucapan ulang tahun, dan antrian auto-reply / pesan gagal terkirim) juga akan ikut terhapus.`)) return;
        try {
            const result = await apiCall(`/admin/customers/${customerId}`, { method: 'DELETE' });
            if (result && result.success) {
                showAdminToast(result.message || 'Customer berhasil dihapus.', 'success');
                closeModal();
                if (typeof loadCustomers === 'function') loadCustomers();
                if (typeof loadFailedWA === 'function') loadFailedWA();
            } else {
                alert(result?.message || 'Gagal menghapus customer');
            }
        } catch (error) {
            console.error('deleteCustomer error:', error);
            alert('Gagal menghapus customer');
        }
    }

    // Modal pemilih transaksi untuk customer dengan >1 pembelian.
    function openDeleteTransactionPicker(customerId, namaLengkap, purchases) {
        const fmtRp = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Number(val) || 0);
        const fmtDate = (d) => d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

        document.getElementById('deleteTxPicker')?.remove(); // hindari modal dobel

        const overlay = document.createElement('div');
        overlay.id = 'deleteTxPicker';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:16px;';

        const rowsHtml = purchases.map((p, i) => {
            const title = [p.merk_unit, p.tipe_unit].filter(Boolean).map(esc).join(' ') || `Transaksi #${i + 1}`;
            const meta = [fmtRp(p.harga), p.qty ? `${p.qty} unit` : '', fmtDate(p.created_at)].filter(Boolean).join(' • ');
            return `
                <label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid #EFE7E1;border-radius:10px;margin-bottom:8px;cursor:pointer;">
                    <input type="checkbox" class="del-tx-cb" value="${p.id}" style="margin-top:3px;width:16px;height:16px;cursor:pointer;">
                    <span style="flex:1;">
                        <span style="display:block;font-weight:600;font-size:13px;color:#1A1412;">#${i + 1} — ${title}</span>
                        <span style="display:block;font-size:12px;color:#8C8078;margin-top:2px;">${meta}</span>
                    </span>
                </label>`;
        }).join('');

        overlay.innerHTML = `
            <div style="background:#fff;border-radius:16px;max-width:460px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
                <div style="padding:18px 20px 12px;border-bottom:1px solid #F0E9E4;">
                    <h3 style="margin:0;font-size:16px;color:#1A1412;">Hapus Transaksi</h3>
                    <p style="margin:6px 0 0;font-size:13px;color:#8C8078;">Customer <strong>${esc(namaLengkap)}</strong> punya ${purchases.length} transaksi. Pilih transaksi yang ingin dihapus.</p>
                </div>
                <div style="padding:14px 20px;overflow-y:auto;">
                    ${rowsHtml}
                    <label style="display:flex;gap:8px;align-items:center;font-size:12px;color:#8C8078;margin-top:4px;cursor:pointer;">
                        <input type="checkbox" id="delTxSelectAll" style="width:15px;height:15px;cursor:pointer;"> Pilih semua (= hapus seluruh customer)
                    </label>
                </div>
                <div style="padding:14px 20px;border-top:1px solid #F0E9E4;display:flex;gap:10px;justify-content:flex-end;">
                    <button type="button" id="delTxCancel" style="padding:9px 16px;border-radius:9px;border:1px solid #E2D8D1;background:#fff;color:#6B5F57;font-size:13px;font-weight:600;cursor:pointer;">Batal</button>
                    <button type="button" id="delTxConfirm" disabled style="padding:9px 16px;border-radius:9px;border:none;background:#DC2626;color:#fff;font-size:13px;font-weight:600;cursor:pointer;opacity:0.5;">Hapus Terpilih</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        const cbs = Array.from(overlay.querySelectorAll('.del-tx-cb'));
        const selectAll = overlay.querySelector('#delTxSelectAll');
        const confirmBtn = overlay.querySelector('#delTxConfirm');
        const cancelBtn = overlay.querySelector('#delTxCancel');
        const close = () => overlay.remove();

        function refreshState() {
            const checked = cbs.filter(cb => cb.checked).length;
            const all = checked === cbs.length && checked > 0;
            selectAll.checked = all;
            confirmBtn.disabled = checked === 0;
            confirmBtn.style.opacity = checked === 0 ? '0.5' : '1';
            confirmBtn.textContent = all ? 'Hapus Customer' : `Hapus Terpilih (${checked})`;
        }

        cbs.forEach(cb => cb.addEventListener('change', refreshState));
        selectAll.addEventListener('change', () => { cbs.forEach(cb => { cb.checked = selectAll.checked; }); refreshState(); });
        cancelBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        confirmBtn.addEventListener('click', async () => {
            const selectedIds = cbs.filter(cb => cb.checked).map(cb => Number(cb.value));
            if (selectedIds.length === 0) return;

            // Semua dipilih → sama saja dengan hapus seluruh customer.
            if (selectedIds.length === purchases.length) {
                close();
                return confirmDeleteWholeCustomer(customerId, namaLengkap);
            }

            // Sebagian dipilih → kirim daftar LENGKAP: yang dipilih ditandai
            // deleted, sisanya dikirim utuh. Wajib utuh, kalau tidak backend
            // bisa meng-null-kan field yang hilang & salah hitung trim antrian
            // (remainingPurchases dihitung dari panjang array yang dikirim).
            const selectedSet = new Set(selectedIds);
            const payload = purchases.map(p => selectedSet.has(p.id)
                ? { id: p.id, deleted: true }
                : {
                    id: p.id, deleted: false,
                    merk_unit: p.merk_unit, tipe_unit: p.tipe_unit,
                    harga: p.harga, qty: p.qty, nama_sales: p.nama_sales,
                    metode_pembayaran: p.metode_pembayaran, source: p.source
                });

            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Menghapus...';
            try {
                const res = await apiCall(`/admin/customers/${customerId}/purchases`, {
                    method: 'PUT',
                    body: JSON.stringify({ purchases: payload })
                });
                if (res && res.success) {
                    showAdminToast(`${selectedIds.length} transaksi dihapus.`, 'success');
                    close();
                    if (typeof loadCustomers === 'function') loadCustomers();
                    if (typeof loadFailedWA === 'function') loadFailedWA();
                } else {
                    alert(res?.message || 'Gagal menghapus transaksi');
                    confirmBtn.disabled = false;
                    refreshState();
                }
            } catch (error) {
                console.error('delete transaction error:', error);
                alert('Gagal menghapus transaksi');
                confirmBtn.disabled = false;
                refreshState();
            }
        });
    }

    window.saveCustomerInfo = async function(customerId) {
        if (!customerId) return;
        const feedback = document.getElementById('detailInfoSaveFeedback');
        const saveButton = document.getElementById('detailInfoSaveButton');
        if (feedback) { feedback.textContent = 'Menyimpan...'; feedback.style.color = '#2563EB'; }
        if (saveButton) saveButton.disabled = true;

        const payload = {
            nama_lengkap: document.getElementById('detailNamaLengkap')?.value.trim(),
            nama_sales: document.getElementById('detailNamaSales')?.value.trim(),
            alamat: document.getElementById('detailAlamat')?.value.trim(),
            tanggal_lahir: document.getElementById('detailTanggalLahir')?.value || null,
            metode_pembayaran: document.getElementById('detailMetodePembayaran')?.value.trim(),
            tahu_dari: document.getElementById('detailTahuDari')?.value.trim(),
            source: document.getElementById('detailSource')?.value.trim(),
            status: document.getElementById('detailStatus')?.value
        };

        try {
            const customerRes = await apiCall(`/admin/customers/${customerId}`, {
                method: 'PATCH',
                body: JSON.stringify(payload)
            });
            if (!customerRes || !customerRes.success) {
                throw new Error(customerRes?.message || 'Gagal menyimpan data customer');
            }
            if (currentDetailCustomer) {
                Object.assign(currentDetailCustomer, payload);
            }
            detailInfoEditMode = false;
            renderCustomerDetailBody();
            showAdminToast('Info customer berhasil disimpan.', 'success');
            if (typeof loadCustomers === 'function') loadCustomers();
            if (typeof loadFailedWA === 'function') loadFailedWA();
        } catch (error) {
            console.error('saveCustomerInfo error:', error);
            if (feedback) { feedback.textContent = 'Gagal menyimpan.'; feedback.style.color = '#DC2626'; }
            alert(error.message || 'Gagal menyimpan perubahan.');
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
    }

    window.savePurchases = async function(customerId) {
        if (!customerId) return;
        const feedback = document.getElementById('purchaseSaveFeedback');
        const saveButton = document.getElementById('purchaseSaveButton');
        if (feedback) { feedback.textContent = 'Menyimpan...'; feedback.style.color = '#2563EB'; }
        if (saveButton) saveButton.disabled = true;

        const purchases = (detailCustomerDraft?.purchases || []).map((item, index) => {
            if (item.deleted && item.id) return { id: item.id, deleted: true };
            if (item.deleted) return null;
            const row = document.querySelector(`#purchaseEditorRows tr[data-index="${index}"]`);
            const values = getPurchaseRowValues(row, item);
            return {
                id: item.id || null,
                deleted: false,
                merk_unit: values.merk_unit,
                tipe_unit: values.tipe_unit,
                harga: values.harga,
                qty: values.qty,
                nama_sales: values.nama_sales,
                metode_pembayaran: values.metode_pembayaran,
                source: values.source
            };
        }).filter(item => {
            if (!item) return false;
            if (item.deleted && item.id) return true;
            return item.merk_unit || item.tipe_unit || item.harga || item.qty;
        });

        try {
            const purchasesRes = await apiCall(`/admin/customers/${customerId}/purchases`, {
                method: 'PUT',
                body: JSON.stringify({ purchases })
            });
            if (!purchasesRes || !purchasesRes.success) {
                throw new Error(purchasesRes?.message || 'Gagal menyimpan data pembelian');
            }
            if (feedback) { feedback.textContent = 'Tersimpan!'; feedback.style.color = '#16A34A'; }
            showAdminToast('Riwayat pembelian berhasil disimpan.', 'success');
            if (detailCustomerDraft) {
                if (purchasesRes.data?.purchases) {
                    detailCustomerDraft.purchases = purchasesRes.data.purchases.map(p => ({ ...p, isEditing: false, deleted: false }));
                } else {
                    detailCustomerDraft.purchases = detailCustomerDraft.purchases
                        .filter(p => !p.deleted)
                        .map(p => ({ ...p, isEditing: false }));
                }
                renderPurchaseEditor();
            }
            if (typeof loadCustomers === 'function') loadCustomers();
            if (typeof loadFailedWA === 'function') loadFailedWA();
        } catch (error) {
            console.error('savePurchases error:', error);
            if (feedback) { feedback.textContent = 'Gagal menyimpan.'; feedback.style.color = '#DC2626'; }
            alert(error.message || 'Gagal menyimpan riwayat pembelian.');
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
    }

    window.closeModal = function() {
        document.getElementById('customerModal').classList.remove('show');
    };

    window.updateStatus = async function(customerId, newStatus, selectEl) {
        const res = await apiCall(`/admin/customers/${customerId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus })
        });
        if (res && res.success) {
            selectEl.className = 'status-select ' + newStatus.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            if (allCustomers.length > 0) loadCustomers();
        }
    };

    window.saveCatatan = async function(customerId, value) {
        const res = await apiCall(`/admin/customers/${customerId}/catatan`, {
            method: 'PATCH',
            body: JSON.stringify({ catatan: value })
        });
        if (res && res.success) {
            const c = allCustomers.find(c => c.id === customerId);
            if (c) c.catatan = value;
            showAdminToast('Catatan tersimpan', 'success');
        }
    };

    // Close modal on backdrop click
    document.getElementById('customerModal').addEventListener('click', (e) => {
        if (e.target.id === 'customerModal') {
            closeModal();
        }
    });

    // ============================================
    // MESSAGES PAGE + DATA CLEANUP
    // ============================================

    // --- Resource usage + Full backup ---

    window.loadResourceUsage = async function() {
        const container = document.getElementById('resourceContainer');
        if (!container) return;
        const res = await apiCall('/admin/resource-usage');
        if (!res || !res.success) {
            container.innerHTML = '<p class="muted">Gagal memuat info storage.</p>';
            return;
        }
        const d = res.data;
        const pct = d.pctOfFreeTier;
        const barColor = pct > 80 ? '#DC2626' : pct > 60 ? '#F59E0B' : '#16A34A';
        const warningBox = d.warning
            ? `<div style="background:#FEE2E2;border:1px solid #FCA5A5;color:#991B1B;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:13px;">⚠️ ${esc(d.warning)}</div>`
            : '';
        const rowsHtml = d.tableCounts.map(t => `
            <tr><td style="padding:6px 10px;border-bottom:1px solid #F5F3F0;">${esc(t.table_name)}</td>
                <td style="padding:6px 10px;border-bottom:1px solid #F5F3F0;text-align:right;font-weight:500;">${t.rows.toLocaleString('id-ID')}</td></tr>`).join('');

        container.innerHTML = `
            ${warningBox}
            <div style="margin-bottom:14px;">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
                    <span><strong>${d.dbSizeMB} MB</strong> dari ${d.supabaseFreeLimitMB} MB Supabase Free</span>
                    <span style="color:${barColor};font-weight:600;">${pct}%</span>
                </div>
                <div style="background:#F5F3F0;border-radius:6px;height:10px;overflow:hidden;">
                    <div style="background:${barColor};height:100%;width:${Math.min(100, pct)}%;border-radius:6px;transition:width 0.4s;"></div>
                </div>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
                <button class="btn-primary" style="padding:8px 16px;font-size:13px;" onclick="downloadFullBackup()">
                    💾 Download Full Backup (CSV)
                </button>
                <span style="font-size:11px;color:#8C8078;align-self:center;">
                    Auto-cleanup berikutnya: <strong>tanggal 1 bulan depan, 03:00 WITA</strong>
                </span>
            </div>

            <details>
                <summary style="cursor:pointer;font-size:13px;color:#5C534B;font-weight:500;margin-bottom:8px;">Detail tabel</summary>
                <table style="width:100%;font-size:13px;margin-top:8px;border-collapse:collapse;">
                    <thead><tr style="background:#FAFAF8;">
                        <th style="padding:6px 10px;text-align:left;font-weight:600;">Tabel</th>
                        <th style="padding:6px 10px;text-align:right;font-weight:600;">Jumlah Row</th>
                    </tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </details>
        `;
    };

    window.downloadFullBackup = async function() {
        const btn = event?.target;
        const origText = btn?.textContent;
        if (btn) { btn.disabled = true; btn.textContent = 'Membuat backup...'; }
        try {
            const response = await fetch(`${API_URL}/admin/backup/full`, { credentials: 'include' });
            if (!response.ok) throw new Error(`Server returned ${response.status}`);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cahaya-phone-full-backup-${toWITADate(new Date())}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            alert('✅ Backup berhasil di-download. Simpan file ini di tempat aman (Google Drive / external storage).');
        } catch (e) {
            alert('❌ Gagal download backup: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = origText; }
        }
    };

    // --- Cleanup functions ---

    window.loadCleanupStatus = async function() {
        const container = document.getElementById('cleanupContainer');
        const res = await apiCall('/admin/cleanup/status');

        if (!res || !res.success) {
            container.innerHTML = '<p class="muted">Gagal memuat status cleanup.</p>';
            return;
        }

        const d = res.data;
        const hasOldData = d.totalOldRecords > 0;

        let urgencyColor = '#8C8078';
        let urgencyText = 'Aman';
        if (d.daysUntilCleanup !== null) {
            if (d.daysUntilCleanup <= 0) {
                urgencyColor = '#DC2626';
                urgencyText = 'Perlu dihapus sekarang!';
            } else if (d.daysUntilCleanup <= 3) {
                urgencyColor = '#F59E0B';
                urgencyText = `${d.daysUntilCleanup} hari lagi`;
            } else if (d.daysUntilCleanup <= 7) {
                urgencyColor = '#F59E0B';
                urgencyText = `${d.daysUntilCleanup} hari lagi`;
            } else {
                urgencyText = `${d.daysUntilCleanup} hari lagi`;
            }
        }

        container.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px;">
                <div style="background:#F5F3F0;padding:14px;border-radius:8px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:#B91C1C;">${d.oldMessages}</div>
                    <div style="font-size:11px;color:#8C8078;">Chat Log Lama</div>
                </div>
                <div style="background:#F5F3F0;padding:14px;border-radius:8px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:#B91C1C;">${d.oldBroadcastJobs}</div>
                    <div style="font-size:11px;color:#8C8078;">Broadcast Job Lama</div>
                </div>
                <div style="background:#F5F3F0;padding:14px;border-radius:8px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:#B91C1C;">${d.oldBroadcastRecipients}</div>
                    <div style="font-size:11px;color:#8C8078;">Log Penerima Lama</div>
                </div>
                <div style="background:#F5F3F0;padding:14px;border-radius:8px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:${urgencyColor};">${urgencyText}</div>
                    <div style="font-size:11px;color:#8C8078;">Waktu Cleanup</div>
                </div>
            </div>
            ${hasOldData ? `
                <p style="font-size:13px;color:#5C534B;margin:0 0 12px;">Ada <strong>${d.totalOldRecords}</strong> data lebih dari ${d.cleanupDays} hari. Data customer & pembelian <strong>tidak akan dihapus</strong>, hanya chat log dan broadcast log.</p>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <button class="btn-primary" style="width:auto;font-size:13px;" onclick="exportThenDelete()">Export CSV lalu Hapus</button>
                    <button class="btn-small" style="font-size:13px;padding:8px 16px;background:rgba(220,38,38,0.08);color:#DC2626;border:1px solid rgba(220,38,38,0.2);" onclick="deletePermanent()">Hapus Permanen</button>
                    <button class="btn-small" style="font-size:13px;padding:8px 16px;" onclick="exportLogsOnly()">Export CSV Saja</button>
                </div>
            ` : `<p class="muted" style="margin:0 0 6px;">Tidak ada data lama yang perlu dibersihkan.</p>
                 <p style="font-size:11px;color:#8C8078;margin:0;">ℹ️ Cleanup hanya hapus pesan chat & broadcast yang sudah <strong>lebih dari ${d.cleanupDays} hari</strong>. Chat log yang ditampilkan di bawah ini masih recent, akan otomatis masuk antrian cleanup setelah berusia ${d.cleanupDays} hari.</p>`}
        `;

        // Update banner di dashboard
        updateCleanupBanner(d);
    };

    function updateCleanupBanner(d) {
        const banner = document.getElementById('cleanupBanner');
        if (!banner) return;

        if (d.totalOldRecords > 0 && d.daysUntilCleanup !== null && d.daysUntilCleanup <= 7) {
            banner.style.display = 'block';
            const title = document.getElementById('cleanupBannerTitle');
            const text = document.getElementById('cleanupBannerText');

            if (d.daysUntilCleanup <= 0) {
                banner.style.background = 'linear-gradient(135deg,#FEE2E2,#FECACA)';
                banner.style.borderColor = '#DC2626';
                title.textContent = 'Data Perlu Dihapus!';
                title.style.color = '#DC2626';
                text.style.color = '#DC2626';
                text.textContent = `${d.totalOldRecords} data chat & broadcast sudah lebih dari ${d.cleanupDays} hari. Silakan export atau hapus untuk menghemat storage.`;
            } else {
                title.textContent = `Cleanup dalam ${d.daysUntilCleanup} hari`;
                text.textContent = `${d.totalOldRecords} data chat & broadcast akan perlu dihapus. Klik "Kelola Data" untuk export atau hapus.`;
            }
        } else {
            banner.style.display = 'none';
        }
    }

    window.navigateToCleanup = function() {
        // Navigate ke Chat Log page
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-page="messages"]').classList.add('active');
        document.getElementById('messagesPage').classList.add('active');
        loadMessages();
        loadCleanupStatus();
    };

    window.exportLogsOnly = async function() {
        try {
            const response = await fetch(`${API_URL}/admin/cleanup/export`, {
                credentials: 'include'
            });
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup-logs-${toWITADate(new Date())}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            alert('Export berhasil! File CSV sudah didownload.');
        } catch (e) {
            alert('Gagal export: ' + e.message);
        }
    };

    window.exportThenDelete = async function() {
        if (!confirm('Data chat log & broadcast log yang lebih dari 30 hari akan di-export ke CSV lalu dihapus permanen. Lanjutkan?')) return;

        // Export dulu
        try {
            const response = await fetch(`${API_URL}/admin/cleanup/export`, {
                credentials: 'include'
            });
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup-logs-${toWITADate(new Date())}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert('Gagal export, hapus dibatalkan: ' + e.message);
            return;
        }

        // Tunggu sebentar biar download mulai
        await new Promise(r => setTimeout(r, 1000));

        // Lalu hapus
        const res = await apiCall('/admin/cleanup/delete', { method: 'POST', body: '{}' });
        if (res && res.success) {
            alert(`Berhasil! ${res.deleted.total} data lama sudah dihapus.\n\nFile backup CSV sudah didownload.`);
            loadCleanupStatus();
            loadMessages();
        } else {
            alert('Export berhasil tapi gagal menghapus: ' + (res?.message || 'Unknown error'));
        }
    };

    window.deletePermanent = async function() {
        if (!confirm('PERHATIAN: Data chat log & broadcast log yang lebih dari 30 hari akan DIHAPUS PERMANEN tanpa backup. Yakin?')) return;
        if (!confirm('Benar-benar yakin? Data tidak bisa dikembalikan.')) return;

        const res = await apiCall('/admin/cleanup/delete', { method: 'POST', body: '{}' });
        if (res && res.success) {
            alert(`${res.deleted.total} data lama berhasil dihapus permanen.`);
            loadCleanupStatus();
            loadMessages();
        } else {
            alert('Gagal menghapus: ' + (res?.message || 'Unknown error'));
        }
    };

    // Load cleanup status saat dashboard load
    async function loadCleanupBanner() {
        const res = await apiCall('/admin/cleanup/status');
        if (res && res.success) updateCleanupBanner(res.data);
    }

    async function checkWADisconnectBanner() {
        const banner = document.getElementById('waDisconnectBanner');
        if (!banner) return;

        try {
            const [waRes, failedRes] = await Promise.all([
                apiCall('/admin/wa/status'),
                apiCall('/admin/wa/failed')
            ]);

            const isConnected = waRes && waRes.success && ['ready', 'connected', 'open'].includes(waRes.status);
            const failedCount = (failedRes && failedRes.success) ? failedRes.count : 0;
            const autoPending = !!(failedRes && failedRes.has_auto_pending);
            const inHours = failedRes?.is_working_hours !== false;

            const titleEl = banner.querySelector('strong');
            const textEl = document.getElementById('waDisconnectText');

            if (!isConnected) {
                // WA terputus — banner MERAH
                banner.style.display = 'block';
                banner.style.background = 'linear-gradient(135deg,#FEE2E2,#FECACA)';
                banner.style.borderColor = '#DC2626';
                titleEl.style.color = '#DC2626';
                titleEl.textContent = 'WhatsApp Terputus!';
                textEl.style.color = '#DC2626';
                textEl.innerHTML = failedCount > 0
                    ? `Auto-reply tidak aktif. Ada <strong>${failedCount}</strong> pesan tertahan di antrian.`
                    : 'Auto-reply dan broadcast tidak aktif.';
            } else if (failedCount > 0) {
                // Banner kuning, pesan kontekstual sesuai status antrian.
                banner.style.display = 'block';
                banner.style.background = 'linear-gradient(135deg,#FEF3C7,#FDE68A)';
                banner.style.borderColor = '#F59E0B';
                titleEl.style.color = '#92400E';
                textEl.style.color = '#92400E';
                if (!inHours) {
                    titleEl.textContent = 'Antrian Menunggu Jam Operasional';
                    textEl.innerHTML = `<strong>${failedCount}</strong> pesan menunggu — otomatis dikirim mulai 08:00 WITA.`;
                } else if (autoPending) {
                    titleEl.textContent = 'Antrian Otomatis Berjalan';
                    textEl.innerHTML = `Sistem memproses <strong>${failedCount}</strong> pesan dengan delay anti-ban. Tombol manual nonaktif sampai antrian selesai.`;
                } else {
                    titleEl.textContent = 'Pesan Menunggu Manual';
                    textEl.innerHTML = `Ada <strong>${failedCount}</strong> pesan menunggu kirim manual. Buka WA Connect untuk kirim.`;
                }
            } else {
                // Semua OK — sembunyikan banner
                banner.style.display = 'none';
            }
        } catch (e) {
            banner.style.display = 'none';
        }
    }

    // --- Messages functions ---

    async function loadMessages() {
        const container = document.getElementById('messagesTable');
        container.innerHTML = '<div class="loading">Loading...</div>';

        console.log('💬 Loading messages...');
        const result = await apiCall('/admin/messages');
        
        if (result && result.success) {
            console.log(`✅ Loaded ${result.data.length} messages`);
            allMessages = result.data;
            displayMessages(allMessages);
        } else {
            console.error('❌ Failed to load messages');
            container.innerHTML = '<div class="no-data">Gagal memuat data</div>';
        }
    }

    function displayMessages(messages) {
        const container = document.getElementById('messagesTable');
        
        if (messages.length === 0) {
            container.innerHTML = '<div class="no-data">Belum ada pesan</div>';
            return;
        }

        let html = `
            <table>
                <thead>
                    <tr>
                        <th>No</th>
                        <th>Nama Customer</th>
                        <th>WhatsApp</th>
                        <th>Arah</th>
                        <th>Pesan</th>
                        <th>Waktu</th>
                    </tr>
                </thead>
                <tbody>
        `;

        messages.forEach((msg, index) => {
            const time = formatWaktu(msg.sent_at);
            const directionClass = msg.direction;
            const directionText = msg.direction === 'in' ? 'Masuk' : 'Keluar';
            
            html += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${esc(msg.nama_lengkap)}</td>
                    <td>${esc(msg.whatsapp)}</td>
                    <td><span class="badge ${directionClass}">${directionText}</span></td>
                    <td style="max-width: 300px;">${esc(msg.message)}</td>
                    <td>${time}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // ============================================
    // EXPORT CONTACTS
    // ============================================

    function getExportParams() {
        const source = document.getElementById('filterSource').value;
        const status = document.getElementById('filterStatus').value;
        const dateFrom = document.getElementById('filterDateFrom').value;
        const dateTo = document.getElementById('filterDateTo').value;
        let params = '';
        if (source) params += `&source=${encodeURIComponent(source)}`;
        if (status) params += `&status=${encodeURIComponent(status)}`;
        if (dateFrom) params += `&date_from=${dateFrom}`;
        if (dateTo) params += `&date_to=${dateTo}`;
        return params;
    }

    async function doExport(format) {
        try {
            const filterParams = getExportParams();
            const res = await fetch(`${API_URL}/admin/customers/export?format=${format}${filterParams}`, {
                credentials: 'include'
            });

            if (!res.ok) {
                const err = await res.json().catch(() => null);
                alert(err && err.message ? err.message : 'Gagal export CSV (status ' + res.status + ')');
                return;
            }

            const contentType = res.headers.get('Content-Type') || '';
            if (contentType.includes('application/json')) {
                const err = await res.json();
                alert(err.message || 'Gagal export CSV');
                return;
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const today = toWITADate(new Date());
            const prefix = format === 'simple' ? 'contacts' : 'customers';
            link.href = url;
            link.download = `${prefix}_${today}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Export error:', e);
            alert('Gagal export. Pastikan koneksi ke server OK.');
        }
    }

    // ============================================
    // BACKUP & CLEANUP — moved here from Messages page per user request.
    // Workflow: Download backup → Cleanup button reveals → Confirm → batched delete.
    // ============================================
    const customerBackupBtn = document.getElementById('customerBackupBtn');
    const customerCleanupBtn = document.getElementById('customerCleanupBtn');

    if (customerBackupBtn) {
        customerBackupBtn.addEventListener('click', async () => {
            const origText = customerBackupBtn.textContent;
            customerBackupBtn.disabled = true;
            customerBackupBtn.textContent = '⏳ Membuat backup...';
            try {
                const response = await fetch(`${API_URL}/admin/backup/full`, { credentials: 'include' });
                if (!response.ok) {
                    const errJson = await response.json().catch(() => null);
                    throw new Error(errJson?.message || `Server returned ${response.status}`);
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `cahaya-phone-full-backup-${toWITADate(new Date())}.csv`;
                link.click();
                URL.revokeObjectURL(url);
                alert('✅ Backup berhasil di-download.\n\nSimpan file ini di Google Drive / external storage.\n\nSetelah pastikan file bisa dibuka di Excel, klik "Cleanup Data Lama" untuk hapus log >14-30 hari.');
                // Reveal the cleanup button now that backup is in user's hands
                customerCleanupBtn.style.display = 'inline-flex';
            } catch (e) {
                console.error('Backup error:', e);
                alert('❌ Gagal download backup: ' + e.message);
            } finally {
                customerBackupBtn.disabled = false;
                customerBackupBtn.textContent = origText;
            }
        });
    }

    if (customerCleanupBtn) {
        customerCleanupBtn.addEventListener('click', async () => {
            if (!confirm(
                'PERINGATAN: SEMUA log bulanan akan dihapus permanen.\n\n' +
                'Yang akan DIHAPUS (regardless of age):\n' +
                '• Semua chat messages\n' +
                '• Semua WA logs (SENT + FAILED + QUEUED)\n' +
                '• Semua broadcast jobs + recipients\n' +
                '• Semua audit logs\n' +
                '• Daily stats + reset tokens\n\n' +
                'Yang AMAN (TIDAK dihapus):\n' +
                '• Data customer (semua nama/HP/alamat tetap)\n' +
                '• Riwayat pembelian (purchases)\n' +
                '• Birthday greeting log (per-tahun idempotency)\n' +
                '• Admin accounts + Google tokens + app settings\n\n' +
                'Sudah PASTIKAN backup CSV ter-download? Lanjutkan cleanup bulanan?'
            )) return;

            const origText = customerCleanupBtn.textContent;
            customerCleanupBtn.disabled = true;
            customerCleanupBtn.textContent = '⏳ Membersihkan...';
            try {
                const result = await apiCall('/admin/cleanup/monthly', { method: 'POST' });
                if (result && result.success) {
                    const d = result.deleted;
                    alert(`✅ ${d.total} data berhasil dihapus.\n\n` +
                          `• Chat messages: ${d.messages}\n` +
                          `• WA logs: ${d.waMessageLogs}\n` +
                          `• Broadcast: ${d.broadcastJobs} job + ${d.broadcastRecipients} penerima\n` +
                          `• Audit logs: ${d.auditLogs}\n` +
                          `• Daily stats: ${d.waDailyStats}\n` +
                          `• Reset tokens: ${d.expiredTokens}`);
                    customerCleanupBtn.style.display = 'none';
                    if (typeof loadCustomers === 'function') loadCustomers();
                    const banner = document.getElementById('backupBanner');
                    if (banner) banner.style.display = 'none';
                    // Refresh status so backup button disables until new data arrives
                    loadBackupBanner();
                } else {
                    alert('❌ Cleanup gagal: ' + (result?.message || 'Unknown error'));
                }
            } catch (e) {
                alert('❌ Cleanup error: ' + e.message);
            } finally {
                customerCleanupBtn.disabled = false;
                customerCleanupBtn.textContent = origText;
            }
        });
    }

    // ============================================
    // WA CONNECT
    // ============================================

    let waStatusInterval = null;

    window.loadWAStatus = async function() {
        const container = document.getElementById('waStatusContainer');
        const res = await apiCall('/admin/wa/status');

        if (!res || !res.success) {
            const errorMsg = res?.error || 'Tidak bisa terhubung ke WA Bridge';
            container.innerHTML = `
                <div style="text-align:center;padding:30px;">
                    <div style="font-size:48px;margin-bottom:12px;">&#x26A0;</div>
                    <h4 style="margin:0 0 8px;color:#DC2626;">WA Bridge Tidak Tersedia</h4>
                    <p class="muted" style="margin:0 0 16px;">${errorMsg}</p>
                    <p class="muted" style="font-size:12px;">Pastikan WA Bridge sudah di-deploy di Railway dan WA_BRIDGE_URL sudah diset di environment variables.</p>
                </div>
            `;
            // Stop polling
            if (waStatusInterval) { clearInterval(waStatusInterval); waStatusInterval = null; }
            return;
        }

        const { status, qr, info, messagesSentToday, dailyLimit } = res;

        // Update daily stats on the settings section
        const sentEl = document.getElementById('waSentToday');
        if (sentEl) sentEl.textContent = `${messagesSentToday || 0} / ${dailyLimit || 200}`;
        const limitEl = document.getElementById('waDailyLimit');
        if (limitEl && dailyLimit) limitEl.value = dailyLimit;

        if ((status === 'ready' || status === 'connected' || status === 'open') && info) {
            // Connected
            container.innerHTML = `
                <div style="text-align:center;padding:20px;">
                    <div style="width:80px;height:80px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18c-1.66 0-3.203-.51-4.484-1.375l-.316-.191-2.789.828.779-2.715-.215-.336A7.943 7.943 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>
                    </div>
                    <h3 style="margin:0 0 4px;color:#25D366;">WhatsApp Terhubung</h3>
                    <p style="margin:0 0 4px;font-size:16px;font-weight:600;">${info.name || '-'}</p>
                    <p class="muted" style="margin:0 0 4px;">+${info.phone}</p>
                    <p class="muted" style="margin:0;font-size:12px;">Platform: ${info.platform || '-'}</p>
                    <div style="margin-top:16px;padding:12px;background:rgba(37,211,102,0.08);border-radius:8px;">
                        <span style="font-size:13px;">Pesan terkirim hari ini: <strong style="color:#25D366;">${messagesSentToday || 0}</strong> / ${dailyLimit || 200}</span>
                    </div>
                </div>
            `;
            // Stop polling when connected
            if (waStatusInterval) { clearInterval(waStatusInterval); waStatusInterval = null; }

        } else if (status === 'qr_pending' && qr) {
            // Show QR code
            container.innerHTML = `
                <div style="text-align:center;padding:20px;">
                    <h4 style="margin:0 0 12px;">Scan QR Code dengan WhatsApp</h4>
                    <p class="muted" style="margin:0 0 16px;font-size:13px;">Buka WhatsApp > Menu > Linked Devices > Link a Device</p>
                    <img src="${qr}" alt="QR Code" style="width:280px;height:280px;border:2px solid #EDE8E3;border-radius:12px;">
                    <p class="muted" style="margin:16px 0 0;font-size:12px;">QR akan refresh otomatis...</p>
                </div>
            `;
            // Start polling for status updates (every 3 seconds while QR is showing)
            if (!waStatusInterval) {
                waStatusInterval = setInterval(loadWAStatus, 3000);
            }

        } else if (status === 'authenticated') {
            container.innerHTML = `
                <div style="text-align:center;padding:30px;">
                    <div class="loading">Menghubungkan WhatsApp...</div>
                    <p class="muted" style="margin-top:8px;">Authenticated, sedang loading...</p>
                </div>
            `;
            if (!waStatusInterval) {
                waStatusInterval = setInterval(loadWAStatus, 3000);
            }

        } else {
            // Disconnected or error
            container.innerHTML = `
                <div style="text-align:center;padding:30px;">
                    <div style="font-size:48px;margin-bottom:12px;">&#x1F4F1;</div>
                    <h4 style="margin:0 0 8px;">WhatsApp Belum Terhubung</h4>
                    <p class="muted" style="margin:0 0 16px;">Status: ${status}${res.lastError ? ' - ' + res.lastError : ''}</p>
                    <button class="btn-primary" style="width:auto;" onclick="restartWA()">Mulai Koneksi (Generate QR)</button>
                </div>
            `;
            if (waStatusInterval) { clearInterval(waStatusInterval); waStatusInterval = null; }
        }
    };

    window.loadWAAutoReply = async function() {
        const res = await apiCall('/admin/wa/auto-reply');
        if (res && res.success) {
            const msgEl = document.getElementById('waAutoReplyMessage');
            if (msgEl && res.autoReplyMessage) msgEl.value = res.autoReplyMessage;
        }
    };

    // Kept for compatibility with the toggle in dashboard card (now handled by saveAutoToggle)
    window.toggleWAAutoReply = async function() {};

    window.saveWAAutoReply = async function() {
        const message = document.getElementById('waAutoReplyMessage').value.trim();
        if (!message) { alert('Pesan auto-reply tidak boleh kosong!'); return; }

        const res = await apiCall('/admin/wa/auto-reply', {
            method: 'POST',
            body: JSON.stringify({ message })
        });
        if (res && res.success) {
            alert('Template auto-reply berhasil disimpan!');
        } else {
            alert('Gagal menyimpan: ' + (res?.error || 'Unknown error'));
        }
    };

    window.saveWASettings = async function() {
        const dailyLimit = parseInt(document.getElementById('waDailyLimit').value);
        if (!dailyLimit || dailyLimit < 10) { alert('Limit minimal 10 pesan/hari'); return; }

        const res = await apiCall('/admin/wa/settings', {
            method: 'POST',
            body: JSON.stringify({ dailyLimit })
        });
        if (res && res.success) {
            alert('Settings berhasil disimpan!');
        } else {
            alert('Gagal menyimpan: ' + (res?.error || 'Unknown error'));
        }
    };

    window.disconnectWA = async function() {
        if (!confirm('Yakin mau disconnect WhatsApp? Anda perlu scan QR ulang nanti.')) return;

        const res = await apiCall('/admin/wa/disconnect', { method: 'POST', body: '{}' });
        if (res && res.success) {
            alert('WhatsApp berhasil di-disconnect.');
            loadWAStatus();
        } else {
            alert('Gagal disconnect: ' + (res?.error || 'Unknown error'));
        }
    };

    window.restartWA = async function() {
        const container = document.getElementById('waStatusContainer');
        container.innerHTML = '<div class="loading">Restarting WhatsApp client...</div>';

        const res = await apiCall('/admin/wa/restart', { method: 'POST', body: '{}' });
        if (res && res.success) {
            // Start polling for QR
            setTimeout(loadWAStatus, 2000);
        } else {
            alert('Gagal restart: ' + (res?.error || 'Unknown error'));
            loadWAStatus();
        }
    };

    // ============================================
    // FAILED WA MESSAGES - RETRY
    // ============================================

    // Polling state: which customer we're currently "sending" (spinner shown,
    // poll every 3s until they disappear from failed list).
    let _waManualSendingId = null;
    let _waPollIntervalId = null;
    const WA_POLL_TIMEOUT_MS = 15 * 60_000;  // give up after 15 min
    let _waPollStartedAt = 0;

    // Auto-poll: refresh every 30s when auto-dispatch entries exist so admin
    // sees them disappear in real-time as the worker sends them.
    let _waAutoPollId = null;
    function _waStartAutoPoll() {
        if (_waAutoPollId) return;
        _waAutoPollId = setInterval(() => { loadFailedWA(); }, 30_000);
    }
    function _waStopAutoPoll() {
        if (_waAutoPollId) { clearInterval(_waAutoPollId); _waAutoPollId = null; }
    }

    function _waStopPolling() {
        if (_waPollIntervalId) { clearInterval(_waPollIntervalId); _waPollIntervalId = null; }
        _waManualSendingId = null;
        _waPollStartedAt = 0;
    }

    function _waStartPolling(customerId) {
        _waManualSendingId = customerId;
        _waPollStartedAt = Date.now();
        if (_waPollIntervalId) clearInterval(_waPollIntervalId);
        _waPollIntervalId = setInterval(() => {
            if (Date.now() - _waPollStartedAt > WA_POLL_TIMEOUT_MS) {
                _waStopPolling();
                alert('Pengiriman manual masih berlangsung lebih dari 15 menit. Cek koneksi WA bridge atau refresh untuk lihat status.');
                loadFailedWA();
                return;
            }
            loadFailedWA();
        }, 3000);
    }

    window.loadFailedWA = async function() {
        const container = document.getElementById('failedWAContainer');
        if (!container) return;
        const res = await apiCall('/admin/wa/failed');
        if (!res || !res.success || res.count === 0) {
            container.innerHTML = '<div class="no-data" style="color:#25D366;">Semua pesan berhasil terkirim ✓</div>';
            _waStopPolling();
            _waStopAutoPoll();
            return;
        }

        if (_waManualSendingId && !res.data.some(c => c.id === _waManualSendingId && !c.is_auto)) {
            _waStopPolling();
        }

        const autoPending = !!res.has_auto_pending;
        const isWorkingHours = res.is_working_hours !== false;
        const wh = res.working_hours || { start: 8, end: 22, tz: 'WITA' };

        const autoRows = res.data.filter(c => c.is_auto);
        const manualRows = res.data.filter(c => !c.is_auto);

        if (autoRows.length > 0 && isWorkingHours) {
            _waStartAutoPoll();
        } else {
            _waStopAutoPoll();
        }
        const totalEntries = res.data.reduce((s, c) => s + (c.queue_count || 0), 0);

        let header;
        if (!isWorkingHours) {
            header = `<p style="font-size:13px;color:#92400E;margin:0 0 12px;font-weight:600;">${totalEntries} pesan menunggu — di luar jam operasional (${wh.start}:00–${wh.end}:00 ${wh.tz})</p>`;
        } else if (autoRows.length > 0 && manualRows.length > 0) {
            header = `<p style="font-size:13px;color:#5C534B;margin:0 0 12px;font-weight:600;">${totalEntries} pesan menunggu — ${autoRows.reduce((s,c)=>s+(c.queue_count||0),0)} otomatis, ${manualRows.reduce((s,c)=>s+(c.queue_count||0),0)} manual</p>`;
        } else if (autoRows.length > 0) {
            header = `<p style="font-size:13px;color:#B45309;margin:0 0 12px;font-weight:600;">${totalEntries} pesan dalam antrian otomatis</p>`;
        } else {
            header = `<p style="font-size:13px;color:#B91C1C;margin:0 0 12px;font-weight:600;">${totalEntries} pesan menunggu kirim manual</p>`;
        }

        let html = header;
        html += '<div style="max-height:300px;overflow-y:auto;">';
        html += '<table><thead><tr><th>Nama</th><th>WhatsApp</th><th>Antrian</th><th>Tipe</th><th>Aksi</th></tr></thead><tbody>';

        res.data.forEach(c => {
            const isAuto = c.is_auto === true;
            const isSending = c.log_status === 'SENDING' || (!isAuto && _waManualSendingId === c.id);
            const queueCount = c.queue_count || 0;

            if (isAuto) {
                html += `<tr style="background:rgba(245,158,11,0.04);">
                    <td>${esc(c.nama_lengkap)}</td>
                    <td>${esc(c.whatsapp)}</td>
                    <td style="text-align:center;font-weight:600;color:#B45309;">${queueCount}x</td>
                    <td><span style="font-size:11px;padding:2px 8px;border-radius:6px;background:rgba(245,158,11,0.12);color:#B45309;font-weight:600;">Otomatis</span></td>
                    <td><button class="btn-small" style="padding:4px 12px;font-size:11px;opacity:0.4;cursor:not-allowed;" disabled title="Sistem akan kirim otomatis">${c.log_status === 'SENDING' ? '⏳ Mengirim...' : 'Otomatis'}</button></td>
                </tr>`;
            } else {
                const disableVisual = isSending;
                const btnLabel = isSending ? '⏳ Mengirim...' : 'Kirim Manual';
                const btnStyle = disableVisual
                    ? 'padding:4px 12px;font-size:11px;opacity:0.45;cursor:not-allowed;'
                    : 'padding:4px 12px;font-size:11px;';
                const btnTitle = isSending ? 'Sedang dikirim'
                    : !isWorkingHours ? `Di luar jam operasional (${wh.start}:00–${wh.end}:00 ${wh.tz}) — klik untuk konfirmasi`
                    : autoPending ? 'Antrian otomatis aktif — klik untuk konfirmasi'
                    : 'Kirim manual sekarang';
                const btnAttrs = disableVisual
                    ? `disabled title="${esc(btnTitle)}"`
                    : `onclick="retrySingleWA(${c.id})" title="${esc(btnTitle)}"`;

                html += `<tr>
                    <td>${esc(c.nama_lengkap)}</td>
                    <td>${esc(c.whatsapp)}</td>
                    <td style="text-align:center;font-weight:600;color:#B91C1C;">${queueCount}x</td>
                    <td><span style="font-size:11px;padding:2px 8px;border-radius:6px;background:rgba(185,28,28,0.08);color:#B91C1C;font-weight:600;">Manual</span></td>
                    <td><button class="btn-small" style="${btnStyle}" ${btnAttrs}>${btnLabel}</button></td>
                </tr>`;
            }
        });
        html += '</tbody></table></div>';
        container.innerHTML = html;
    };

    window.retrySingleWA = async function(id) {
        if (_waManualSendingId) {
            alert('Tunggu pengiriman manual sebelumnya selesai dulu.');
            return;
        }
        // Call server first. If rejected (luar jam, antrian auto, dll), no state change,
        // just show notif. If accepted, then start polling for completion.
        const res = await apiCall(`/admin/wa/retry/${id}`, { method: 'POST', body: '{}' });
        if (!res || !res.success) {
            alert(res?.message || 'Gagal kirim manual.');
            return;
        }
        _waStartPolling(id);
        loadFailedWA();  // immediate render with spinner
    };

    window.retryAllWA = async function() {
        if (!confirm('Promosikan SEMUA pesan menunggu manual ke antrian otomatis?\n\nWorker akan kirim satu-per-satu dengan delay anti-ban.')) return;
        const res = await apiCall('/admin/wa/retry-all', { method: 'POST', body: '{}' });
        alert(res?.message || 'Error');
        loadFailedWA();
    };

    // ============================================
    // BROADCAST
    // ============================================

    const broadcastStartBtn = document.getElementById('broadcastStartBtn');
    const broadcastPauseBtn = document.getElementById('broadcastPauseBtn');
    const broadcastResumeBtn = document.getElementById('broadcastResumeBtn');
    const broadcastStopBtn  = document.getElementById('broadcastStopBtn');
    const broadcastStatusEl = document.getElementById('broadcastStatus');
    const dailySentCountEl = document.getElementById('dailySentCount');

    // Load daily sent count on page load
    async function loadDailySentCount() {
        const res = await apiCall('/admin/broadcast/daily-count');
        if (res && res.success) {
            const count = res.daily_sent || 0;
            dailySentCountEl.textContent = count;
            // Color based on count
            if (count >= 300) {
                dailySentCountEl.style.color = '#e74c3c';
            } else if (count >= 100) {
                dailySentCountEl.style.color = '#f39c12';
            } else {
                dailySentCountEl.style.color = '#2ecc71';
            }
        }
    }
    loadDailySentCount();

    function renderBroadcastStatus(status) {
        if (!status) {
            broadcastStatusEl.innerHTML = '<p class="muted">Belum ada broadcast aktif.</p>';
            return;
        }
        const progressPct = status.total > 0 ? Math.round(((status.sent + status.failed) / status.total) * 100) : 0;
        const logHtml = (status.log || []).slice(-20).reverse().map(entry => {
            if (entry.info) return `<div class="muted" style="font-size:12px;">${entry.info}</div>`;
            const icon = entry.success ? '✅' : '❌';
            return `<div style="font-size:12px;">${icon} ${entry.name || entry.phone} — ${entry.success ? 'Terkirim' : 'Gagal: ' + (entry.error || '')}</div>`;
        }).join('');

        // Anti-spam: soft warning at 100 messages/day
        const dailySent = status.daily_sent || 0;
        // Update top counter too
        if (dailySentCountEl) {
            dailySentCountEl.textContent = dailySent;
            dailySentCountEl.style.color = dailySent >= 300 ? '#e74c3c' : dailySent >= 100 ? '#f39c12' : '#2ecc71';
        }
        let warningHtml = '';
        if (dailySent >= 100) {
            const warningColor = dailySent >= 300 ? '#e74c3c' : '#f39c12';
            const warningIcon = dailySent >= 300 ? '🔴' : '🟡';
            const warningText = dailySent >= 300
                ? `${warningIcon} RISIKO TINGGI! Sudah ${dailySent} pesan hari ini. Sangat berisiko banned.`
                : `${warningIcon} Perhatian: Sudah ${dailySent} pesan hari ini. Hati-hati risiko banned.`;
            warningHtml = `<div style="background:${warningColor}15;border:1px solid ${warningColor};color:${warningColor};padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:13px;font-weight:600;">${warningText}</div>`;
        }

        broadcastStatusEl.innerHTML = `
            ${warningHtml}
            <div style="margin-bottom:12px;">
                <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:8px;">
                    <span><strong>Status:</strong> ${status.running ? (status.paused ? '⏸ Dijeda' : '▶ Berjalan') : '⏹ Selesai/Berhenti'}</span>
                    <span><strong>Total:</strong> ${status.total}</span>
                    <span><strong>Terkirim:</strong> <span style="color:green">${status.sent}</span></span>
                    <span><strong>Gagal:</strong> <span style="color:red">${status.failed}</span></span>
                    <span><strong>Antrian:</strong> ${status.queued}</span>
                    <span><strong>Hari ini:</strong> ${dailySent} pesan</span>
                </div>
                <div style="background:#eee;border-radius:4px;height:8px;">
                    <div style="background:#27ae60;width:${progressPct}%;height:8px;border-radius:4px;transition:width 0.3s;"></div>
                </div>
                <small class="muted">${progressPct}% selesai — delay 2-4 menit antar pesan, break 15-30 menit tiap 25-30 pesan, hanya kirim 07-21 WITA</small>
            </div>
            <div style="max-height:200px;overflow-y:auto;border:1px solid #eee;padding:8px;border-radius:4px;">
                ${logHtml || '<span class="muted">Log kosong</span>'}
            </div>
        `;

        // Update button states
        broadcastStartBtn.disabled = status.running && !status.paused;
        broadcastPauseBtn.disabled = !status.running || status.paused;
        broadcastResumeBtn.disabled = !status.paused;
        broadcastStopBtn.disabled = !status.running && status.queued === 0;
    }

    let broadcastProcessing = false;
    let broadcastPollInterval = null;

    // Poll broadcast status from backend (backend-driven processing)
    async function processBroadcastLoop() {
        if (broadcastProcessing) return;
        broadcastProcessing = true;
        broadcastStartBtn.disabled = true;

        if (broadcastPollInterval) clearInterval(broadcastPollInterval);

        broadcastPollInterval = setInterval(async () => {
            const res = await apiCall('/admin/broadcast/status');
            if (!res || !res.success) return;

            renderBroadcastStatus(res.status);

            if (!res.status.running && !res.status.paused) {
                clearInterval(broadcastPollInterval);
                broadcastPollInterval = null;
                broadcastProcessing = false;
            }
        }, 5000);
    }

    function stopBroadcastPoll() {
        if (broadcastPollInterval) {
            clearInterval(broadcastPollInterval);
            broadcastPollInterval = null;
        }
        broadcastProcessing = false;
    }

    broadcastStartBtn.addEventListener('click', async () => {
        const message = document.getElementById('broadcastMessage').value.trim();
        const source = document.getElementById('broadcastSource').value;
        const merk = document.getElementById('broadcastMerk').value;
        const metode = document.getElementById('broadcastMetode').value;
        if (!message) {
            alert('Pesan broadcast tidak boleh kosong!');
            return;
        }
        const filterInfo = [source ? 'source: ' + source : '', merk ? 'merk: ' + merk : '', metode ? 'metode: ' + metode : ''].filter(Boolean).join(', ');
        if (!confirm(`Yakin mau kirim broadcast ke customer${filterInfo ? ' (' + filterInfo + ')' : ' (semua)'}?\n\nPesan:\n${message}`)) return;

        broadcastStartBtn.disabled = true;
        broadcastStartBtn.textContent = 'Memulai...';

        const body = { message };
        if (source) body.source_filter = source;
        if (merk) body.merk_filter = merk;
        if (metode) body.metode_filter = metode;

        const res = await apiCall('/admin/broadcast/start', { method: 'POST', body: JSON.stringify(body) });
        broadcastStartBtn.textContent = '▶ Mulai Broadcast';

        if (res && res.success) {
            renderBroadcastStatus(res.status);
            broadcastPauseBtn.disabled = false;
            broadcastStopBtn.disabled = false;
            // Start processing loop
            processBroadcastLoop();
        } else {
            alert('Gagal memulai broadcast: ' + (res?.message || 'Unknown error'));
            broadcastStartBtn.disabled = false;
        }
    });

    broadcastPauseBtn.addEventListener('click', async () => {
        stopBroadcastPoll();
        const res = await apiCall('/admin/broadcast/pause', { method: 'POST', body: '{}' });
        if (res) {
            const s = await apiCall('/admin/broadcast/status');
            if (s && s.status) renderBroadcastStatus(s.status);
        }
    });

    broadcastResumeBtn.addEventListener('click', async () => {
        const res = await apiCall('/admin/broadcast/resume', { method: 'POST', body: '{}' });
        if (res) {
            processBroadcastLoop();
        }
    });

    broadcastStopBtn.addEventListener('click', async () => {
        if (!confirm('Yakin mau menghentikan broadcast?')) return;
        stopBroadcastPoll();
        const res = await apiCall('/admin/broadcast/stop', { method: 'POST', body: '{}' });
        if (res) {
            const s = await apiCall('/admin/broadcast/status');
            if (s && s.status) renderBroadcastStatus(s.status);
        }
    });

    document.getElementById('refreshStatusBtn').addEventListener('click', async () => {
        const res = await apiCall('/admin/broadcast/status');
        if (res && res.status) renderBroadcastStatus(res.status);
    });


    // ============================================
    // BIRTHDAY GREETING PAGE
    // ============================================

    async function loadBirthdayPage() {
        loadBirthdayToday();
        loadBirthdayHistory();
    }

    window.refreshBirthday = loadBirthdayPage;

    async function loadBirthdayToday() {
        const container = document.getElementById('birthdayTodayList');
        container.innerHTML = '<div class="loading">Loading...</div>';
        try {
            const result = await apiCall('/admin/birthday/today');
            if (!result || !result.success) {
                container.innerHTML = '<div class="no-data">Gagal memuat data</div>';
                return;
            }

            const { customers, message } = result.data;
            document.getElementById('birthdayMessageTemplate').value = message;

            if (customers.length === 0) {
                container.innerHTML = '<div class="no-data" style="text-align:center;padding:30px;color:#8C8078;">Tidak ada customer yang ulang tahun hari ini</div>';
                document.getElementById('sendAllBirthdayBtn').style.display = 'none';
                return;
            }

            const pending = customers.filter(c => c.opted_in !== false && (!c.greeting_id || c.greeting_status === 'failed'));
            document.getElementById('sendAllBirthdayBtn').style.display = pending.length > 0 ? '' : 'none';

            let html = `<table style="width:100%;border-collapse:collapse;"><thead><tr>
                <th style="text-align:left;padding:10px 8px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:12px;">NAMA</th>
                <th style="text-align:left;padding:10px 8px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:12px;">WHATSAPP</th>
                <th style="text-align:left;padding:10px 8px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:12px;">TGL LAHIR</th>
                <th style="text-align:center;padding:10px 8px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:12px;">STATUS</th>
                <th style="text-align:center;padding:10px 8px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:12px;">AKSI</th>
            </tr></thead><tbody>`;

            customers.forEach(c => {
                const tgl = c.tanggal_lahir ? new Date(c.tanggal_lahir).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';
                let statusBadge = '';
                let actionBtn = '';

                if (c.opted_in === false) {
                    statusBadge = '<span style="background:#F3F4F6;color:#6B7280;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;">Opted Out</span>';
                    actionBtn = '<span style="font-size:11px;color:#9CA3AF;">Tidak bisa dikirim</span>';
                } else if (c.greeting_status === 'sent') {
                    statusBadge = '<span style="background:#DCFCE7;color:#16A34A;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;">Terkirim</span>';
                    if (c.sent_at) {
                        try {
                            const d = new Date(c.sent_at);
                            const jam = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Makassar' });
                            statusBadge += `<br><span style="font-size:10px;color:#8C8078;">${jam} WITA</span>`;
                        } catch(e) {}
                    }
                    actionBtn = `<button class="btn-small" onclick="sendBirthdayGreeting(${c.id}, this)" style="font-size:11px;padding:4px 12px;">Kirim Ulang</button>`;
                } else if (c.greeting_status === 'failed') {
                    statusBadge = '<span style="background:#FEE2E2;color:#DC2626;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;">Gagal</span>';
                    if (c.greeting_error) {
                        statusBadge += `<br><span style="font-size:10px;color:#DC2626;" title="${c.greeting_error}">${c.greeting_error.length > 30 ? c.greeting_error.substring(0, 30) + '...' : c.greeting_error}</span>`;
                    }
                    actionBtn = `<button class="btn-small" onclick="sendBirthdayGreeting(${c.id}, this)" style="font-size:11px;padding:4px 12px;">Kirim Ulang</button>`;
                } else {
                    statusBadge = '<span style="background:#FEF3C7;color:#D97706;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;">Belum</span>';
                    actionBtn = `<button class="btn-small" onclick="sendBirthdayGreeting(${c.id}, this)" style="font-size:11px;padding:4px 12px;">Kirim</button>`;
                }

                html += `<tr>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;font-weight:500;">${esc(c.nama_lengkap)}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;font-size:13px;">${esc(c.whatsapp)}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;font-size:13px;">${tgl}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;text-align:center;">${statusBadge}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;text-align:center;">${actionBtn}</td>
                </tr>`;
            });

            html += '</tbody></table>';
            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = '<div class="no-data">Error: ' + err.message + '</div>';
        }
    }

    window.sendBirthdayGreeting = async function(customerId, btnEl) {
        const originalText = btnEl ? btnEl.innerHTML : null;
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = '🔄 Mengirim...';
            btnEl.style.opacity = '0.7';
        }
        try {
            const result = await apiCall('/admin/birthday/send', {
                method: 'POST',
                body: JSON.stringify({ customer_id: customerId })
            });
            if (result && result.success) {
                showAdminToast('Ucapan ulang tahun berhasil dikirim!', 'success');
            } else {
                const errMsg = result?.message || result?.error || 'Gagal mengirim';
                if (result?.outside_working_hours) {
                    showAdminToast('⏰ ' + errMsg, 'error');
                } else if (errMsg.toLowerCase().includes('tidak terdaftar')) {
                    showAdminToast('⚠️ Nomor tidak terdaftar di WhatsApp: ' + errMsg, 'error');
                } else {
                    showAdminToast('Gagal: ' + errMsg, 'error');
                }
            }
        } finally {
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerHTML = originalText;
                btnEl.style.opacity = '1';
            }
            loadBirthdayToday();
            loadBirthdayHistory();
        }
    };

    window.sendAllBirthdayGreetings = async function() {
        if (!confirm('Kirim ucapan ulang tahun ke semua customer yang belum terkirim?')) return;
        const btn = document.getElementById('sendAllBirthdayBtn');
        btn.disabled = true;
        btn.textContent = 'Mengirim...';

        const result = await apiCall('/admin/birthday/send-all', { method: 'POST' });
        if (result && result.success) {
            showAdminToast(result.message || 'Ucapan masuk antrian. Pantau status di halaman ini.', 'success');
        } else if (result?.outside_working_hours) {
            showAdminToast('⏰ ' + (result.message || 'Di luar jam operasional'), 'error');
        } else {
            showAdminToast('Error: ' + (result?.message || 'Gagal'), 'error');
        }

        btn.disabled = false;
        btn.textContent = 'Kirim Semua';
        loadBirthdayToday();
        loadBirthdayHistory();
    };

    window.saveBirthdayMessage = async function() {
        const message = document.getElementById('birthdayMessageTemplate').value;
        const result = await apiCall('/admin/birthday/message', {
            method: 'PUT',
            body: JSON.stringify({ message })
        });
        if (result && result.success) {
            alert('Template pesan berhasil disimpan!');
        } else {
            alert('Gagal menyimpan: ' + (result?.message || 'Error'));
        }
    };

    window.sendBirthdayManual = async function(customerId, buttonElement) {
    // 1. Kunci tombol dan ubah visualnya jadi loading muter-muter
    const originalText = buttonElement.innerHTML;
    buttonElement.disabled = true;
    buttonElement.innerHTML = '🔄 Mengirim...';
    buttonElement.style.opacity = '0.7';
    buttonElement.style.cursor = 'wait';

    try {
        // 2. Tembak API backend
        const res = await apiCall('/admin/birthday/send', {
            method: 'POST',
            body: JSON.stringify({ customer_id: customerId })
        });

        if (res && res.success) {
            // 3. Jika sukses, tombol hilang/berubah jadi badge terkirim
            buttonElement.outerHTML = `<span class="badge badge-success">✅ Terkirim</span>`;
            // Opsional: Panggil loadBirthdayList() lagi untuk me-refresh data
        } else {
            // Jika gagal (misal di luar jam operasional atau masih ada antrian auto)
            alert(res?.message || 'Gagal mengirim pesan.');
            // Kembalikan tombol seperti semula
            buttonElement.disabled = false;
            buttonElement.innerHTML = originalText;
            buttonElement.style.opacity = '1';
            buttonElement.style.cursor = 'pointer';
        }
    } catch (error) {
        alert('Terjadi kesalahan jaringan.');
        buttonElement.disabled = false;
        buttonElement.innerHTML = originalText;
        buttonElement.style.opacity = '1';
        buttonElement.style.cursor = 'pointer';
    }
};

    async function loadBirthdayHistory() {
        const container = document.getElementById('birthdayHistory');
        container.innerHTML = '<div class="loading">Loading...</div>';
        try {
            const result = await apiCall('/admin/birthday/history');
            if (!result || !result.success || result.data.length === 0) {
                container.innerHTML = '<div class="no-data">Belum ada riwayat ucapan</div>';
                return;
            }

            let html = `<table style="width:100%;border-collapse:collapse;"><thead><tr>
                <th style="text-align:left;padding:8px 6px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:11px;">NAMA</th>
                <th style="text-align:left;padding:8px 6px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:11px;">TGL LAHIR</th>
                <th style="text-align:center;padding:8px 6px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:11px;">TAHUN</th>
                <th style="text-align:center;padding:8px 6px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:11px;">STATUS</th>
                <th style="text-align:left;padding:8px 6px;border-bottom:2px solid #EDE8E3;color:#8C8078;font-size:11px;">DIKIRIM</th>
            </tr></thead><tbody>`;

            result.data.forEach(h => {
                const tgl = h.tanggal_lahir ? new Date(h.tanggal_lahir).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-';
                let sentAt = '-';
                if (h.sent_at) {
                    try {
                        const d = new Date(h.sent_at);
                        const tglSent = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar' });
                        const jam = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Makassar' });
                        sentAt = `${tglSent} ${jam} WITA`;
                    } catch(e) {}
                }
                let badge;
                if (h.status === 'sent') {
                    badge = '<span style="background:#DCFCE7;color:#16A34A;padding:2px 8px;border-radius:6px;font-size:11px;">Terkirim</span>';
                } else {
                    badge = '<span style="background:#FEE2E2;color:#DC2626;padding:2px 8px;border-radius:6px;font-size:11px;">Gagal</span>';
                    if (h.error) {
                        const errEsc = esc(h.error);
                        const errShort = h.error.length > 25 ? esc(h.error.substring(0, 25)) + '...' : errEsc;
                        badge += `<br><span style="font-size:10px;color:#DC2626;" title="${errEsc}">${errShort}</span>`;
                    }
                }

                html += `<tr>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;font-size:13px;">${esc(h.nama_lengkap)}</td>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;font-size:13px;">${tgl}</td>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;font-size:13px;text-align:center;">${h.greeting_year}</td>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;text-align:center;">${badge}</td>
                    <td style="padding:8px 6px;border-bottom:1px solid #F5F3F0;font-size:12px;color:#8C8078;">${sentAt}</td>
                </tr>`;
            });

            html += '</tbody></table>';
            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = '<div class="no-data">Error</div>';
        }
    }

    // ============================================
    // ANALYTICS PAGE
    // ============================================

    let analyticsTab = 'buyers';
    let analyticsCache = {};

    async function loadAnalytics() {
        analyticsCache = {};
        await renderAnalyticsTab();
    }

    window.refreshAnalytics = async function() {
        analyticsCache = {};
        await renderAnalyticsTab();
    };

    window.switchAnalyticsTab = function(tab) {
        analyticsTab = tab;
        const tabs = { buyers: 'tabTopBuyers', products: 'tabTopProducts', brands: 'tabTopBrands' };
        Object.entries(tabs).forEach(([key, id]) => {
            const el = document.getElementById(id);
            if (key === tab) {
                el.style.borderBottomColor = '#B91C1C';
                el.style.color = '#B91C1C';
            } else {
                el.style.borderBottomColor = 'transparent';
                el.style.color = '#8C8078';
            }
        });
        renderAnalyticsTab();
    };

    async function renderAnalyticsTab() {
        const container = document.getElementById('analyticsContent');
        container.innerHTML = '<div class="loading">Loading...</div>';
        const formatRp = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val || 0);

        if (analyticsTab === 'buyers') {
            if (!analyticsCache.buyers) {
                const res = await apiCall('/admin/analytics/top-buyers');
                analyticsCache.buyers = (res && res.success) ? res.data : [];
            }
            const data = analyticsCache.buyers;
            if (data.length === 0) {
                container.innerHTML = '<div class="no-data">Belum ada data pembelian</div>';
                return;
            }
            let html = `<table><thead><tr>
                <th>No</th><th>Nama</th><th>WhatsApp</th><th>Total Beli</th><th>Total Belanja</th><th>Aksi</th>
            </tr></thead><tbody>`;
            data.forEach((row, i) => {
                html += `<tr>
                    <td>${i + 1}</td>
                    <td><strong>${esc(row.nama_lengkap)}</strong></td>
                    <td>${esc(row.whatsapp)}</td>
                    <td><span style="background:#B91C1C;color:#fff;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:600;">${row.total_purchases}x</span></td>
                    <td style="font-weight:600;">${formatRp(row.total_spent)}</td>
                    <td><button class="btn-small" onclick="viewCustomer(${row.id})">Detail</button></td>
                </tr>`;
            });
            html += '</tbody></table>';
            container.innerHTML = html;

        } else if (analyticsTab === 'products') {
            if (!analyticsCache.products) {
                const res = await apiCall('/admin/analytics/top-products');
                analyticsCache.products = (res && res.success) ? res.data : [];
            }
            const data = analyticsCache.products;
            if (data.length === 0) {
                container.innerHTML = '<div class="no-data">Belum ada data produk</div>';
                return;
            }
            const maxSold = Math.max(...data.map(d => Number(d.total_sold)));
            let html = `<table><thead><tr>
                <th>No</th><th>Produk</th><th>Terjual</th><th>Total Revenue</th><th>Popularitas</th>
            </tr></thead><tbody>`;
            data.forEach((row, i) => {
                const pct = maxSold > 0 ? (Number(row.total_sold) / maxSold * 100) : 0;
                html += `<tr>
                    <td>${i + 1}</td>
                    <td><strong>${esc(row.merk_unit || '-')}</strong> ${esc(row.tipe_unit || '')}</td>
                    <td><span style="background:rgba(185,28,28,0.08);color:#B91C1C;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:600;">${row.total_sold}x</span></td>
                    <td style="font-weight:500;">${formatRp(row.total_revenue)}</td>
                    <td style="width:150px;">
                        <div style="background:#F5F3F0;border-radius:6px;height:8px;overflow:hidden;">
                            <div style="background:linear-gradient(90deg,#B91C1C,#DC2626);height:100%;width:${pct}%;border-radius:6px;transition:width 0.4s;"></div>
                        </div>
                    </td>
                </tr>`;
            });
            html += '</tbody></table>';
            container.innerHTML = html;

        } else if (analyticsTab === 'brands') {
            if (!analyticsCache.brands) {
                const res = await apiCall('/admin/analytics/top-brands');
                analyticsCache.brands = (res && res.success) ? res.data : [];
            }
            const data = analyticsCache.brands;
            if (data.length === 0) {
                container.innerHTML = '<div class="no-data">Belum ada data merk</div>';
                return;
            }
            const totalAll = data.reduce((sum, d) => sum + Number(d.total_sold), 0);
            const colors = ['#B91C1C','#DC2626','#EF4444','#F87171','#FCA5A5','#FECACA','#FEE2E2','#D97706','#2563EB','#16A34A'];
            let html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:20px;">`;
            data.forEach((row, i) => {
                const pct = totalAll > 0 ? (Number(row.total_sold) / totalAll * 100).toFixed(1) : 0;
                const color = colors[i % colors.length];
                html += `
                    <div style="background:#fff;border:1px solid #EDE8E3;border-radius:12px;padding:16px;transition:box-shadow 0.2s;" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.06)'" onmouseout="this.style.boxShadow='none'">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                            <span style="font-weight:600;font-size:15px;">${row.brand}</span>
                            <span style="background:${color};color:#fff;padding:3px 10px;border-radius:8px;font-size:12px;font-weight:600;">${row.total_sold}x</span>
                        </div>
                        <div style="font-size:13px;color:#5C534B;margin-bottom:8px;">
                            Revenue: <strong>${formatRp(row.total_revenue)}</strong>
                        </div>
                        <div style="background:#F5F3F0;border-radius:6px;height:8px;overflow:hidden;">
                            <div style="background:${color};height:100%;width:${pct}%;border-radius:6px;transition:width 0.4s;"></div>
                        </div>
                        <div style="font-size:11px;color:#8C8078;margin-top:4px;">${pct}% dari total penjualan</div>
                    </div>
                `;
            });
            html += '</div>';
            container.innerHTML = html;
        }
    }

    // ============================================
    // PIPELINE DETAIL MODAL — with year selector & archive
    // ============================================

    const pipelineCache = new Map();   // key: year -> { data, meta }
    let pipelineState = { year: null, type: 'success' };

    async function fetchPipelineYear(year) {
        if (pipelineCache.has(year)) return pipelineCache.get(year);
        const resp = await apiCall(`/admin/pipeline/monthly?year=${year}`);
        if (resp && resp.success) {
            const payload = { data: resp.data, meta: resp.meta };
            pipelineCache.set(year, payload);
            return payload;
        }
        return null;
    }

    window.showPipelineDetail = async function(type) {
        const modal = document.getElementById('pipelineModal');
        const body = document.getElementById('pipelineModalBody');

        modal.classList.add('show');
        body.innerHTML = '<div class="loading">Memuat data...</div>';

        // Default to current year on first open
        if (!pipelineState.year) {
            const initial = await fetchPipelineYear(new Date().getFullYear());
            if (!initial) { body.innerHTML = '<div class="no-data">Gagal memuat</div>'; return; }
            pipelineState.year = initial.meta.year;
        }
        pipelineState.type = type || pipelineState.type || 'success';
        renderPipelineModal();
    };

    window.closePipelineModal = function() {
        document.getElementById('pipelineModal').classList.remove('show');
    };

    window.changePipelineYear = async function(direction) {
        const cached = pipelineCache.get(pipelineState.year);
        const meta = cached && cached.meta;
        if (!meta) return;
        const years = meta.availableYears || [meta.currentYear];
        const idx = years.indexOf(pipelineState.year);
        const newIdx = idx + direction;  // direction: -1 = older, +1 = newer
        if (newIdx < 0 || newIdx >= years.length) return;
        const newYear = years[newIdx];
        const body = document.getElementById('pipelineModalBody');
        body.innerHTML = '<div class="loading">Memuat ' + newYear + '...</div>';
        await fetchPipelineYear(newYear);
        pipelineState.year = newYear;
        renderPipelineModal();
    };

    window.switchPipelineType = function(type) {
        pipelineState.type = type;
        renderPipelineModal();
    };

    function renderPipelineModal() {
        const title = document.getElementById('pipelineModalTitle');
        const body = document.getElementById('pipelineModalBody');
        const cached = pipelineCache.get(pipelineState.year);
        if (!cached) { body.innerHTML = '<div class="no-data">Data belum dimuat</div>'; return; }

        const months = cached.data;
        const meta = cached.meta;
        const type = pipelineState.type;
        const formatRp = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val || 0);

        const years = meta.availableYears || [meta.currentYear];
        const idx = years.indexOf(pipelineState.year);
        const canPrev = idx < years.length - 1;  // older = larger idx
        const canNext = idx > 0;

        const yearBadge = meta.isArchive
            ? '<span style="background:rgba(107,114,128,0.1);color:#6B7280;font-size:11px;padding:3px 10px;border-radius:10px;font-weight:600;margin-left:8px;">Arsip</span>'
            : (meta.isFuture
                ? '<span style="background:rgba(37,99,235,0.1);color:#2563EB;font-size:11px;padding:3px 10px;border-radius:10px;font-weight:600;margin-left:8px;">Mendatang</span>'
                : '<span style="background:rgba(22,163,74,0.1);color:#16A34A;font-size:11px;padding:3px 10px;border-radius:10px;font-weight:600;margin-left:8px;">Aktif</span>');

        title.innerHTML = (type === 'omzet' ? 'Detail Omzet Per Bulan' : 'Detail Transaksi Sukses Per Bulan');

        let tableHtml = '';
        if (months.length === 0) {
            tableHtml = '<div style="text-align:center;padding:40px;color:#8C8078;">Belum ada data untuk ' + pipelineState.year + '</div>';
        } else if (type === 'success') {
            const rows = months.map((m, i) => {
                const prev = months[i - 1];
                const rate = Number(m.total) > 0 ? (Number(m.sukses) / Number(m.total) * 100).toFixed(1) : '0.0';
                let change = '<span style="color:#8C8078;">—</span>';
                if (prev) {
                    const diff = Number(m.sukses) - Number(prev.sukses);
                    if (diff > 0) change = `<span style="color:#16A34A;">▲ +${diff}</span>`;
                    else if (diff < 0) change = `<span style="color:#DC2626;">▼ ${diff}</span>`;
                }
                return `<tr><td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;">${m.label}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;text-align:center;"><strong style="color:#16A34A;">${m.sukses}</strong></td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;text-align:center;">${m.total}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;text-align:center;">${rate}%</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;text-align:center;">${change}</td></tr>`;
            }).join('');
            tableHtml = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#FAFAF8;">
                    <th style="padding:10px 8px;text-align:left;font-size:11px;color:#8C8078;">BULAN</th>
                    <th style="padding:10px 8px;text-align:center;font-size:11px;color:#8C8078;">SUKSES</th>
                    <th style="padding:10px 8px;text-align:center;font-size:11px;color:#8C8078;">TOTAL</th>
                    <th style="padding:10px 8px;text-align:center;font-size:11px;color:#8C8078;">RATE</th>
                    <th style="padding:10px 8px;text-align:center;font-size:11px;color:#8C8078;">PERUBAHAN</th>
                </tr></thead><tbody>${rows}</tbody></table>`;
        } else {
            const rows = months.map((m, i) => {
                const prev = months[i - 1];
                const omzet = Number(m.omzet) || 0;
                let change = '<span style="color:#8C8078;">—</span>';
                if (prev) {
                    const prevOmzet = Number(prev.omzet) || 0;
                    const diff = omzet - prevOmzet;
                    if (prevOmzet > 0) {
                        const pct = ((diff / prevOmzet) * 100).toFixed(1);
                        if (diff > 0) change = `<span style="color:#16A34A;">▲ +${pct}%</span>`;
                        else if (diff < 0) change = `<span style="color:#DC2626;">▼ ${pct}%</span>`;
                    } else if (omzet > 0) {
                        change = `<span style="color:#16A34A;">▲ Baru</span>`;
                    }
                }
                return `<tr><td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;">${m.label}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;text-align:right;"><strong style="color:#B91C1C;">${formatRp(omzet)}</strong></td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;text-align:center;">${m.sukses}</td>
                    <td style="padding:10px 8px;border-bottom:1px solid #F5F3F0;text-align:center;">${change}</td></tr>`;
            }).join('');
            tableHtml = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#FAFAF8;">
                    <th style="padding:10px 8px;text-align:left;font-size:11px;color:#8C8078;">BULAN</th>
                    <th style="padding:10px 8px;text-align:right;font-size:11px;color:#8C8078;">OMZET</th>
                    <th style="padding:10px 8px;text-align:center;font-size:11px;color:#8C8078;">TRANSAKSI</th>
                    <th style="padding:10px 8px;text-align:center;font-size:11px;color:#8C8078;">PERUBAHAN</th>
                </tr></thead><tbody>${rows}</tbody></table>`;
        }

        const archiveNotice = meta.isArchive
            ? '<div style="background:#FAFAF8;border:1px solid #EDE8E3;padding:8px 12px;border-radius:6px;font-size:12px;color:#5C534B;margin-bottom:12px;"><strong>Arsip ' + pipelineState.year + '</strong> — data tahun lewat, hanya untuk referensi.</div>'
            : (meta.year === meta.currentYear
                ? '<div style="font-size:11px;color:#8C8078;margin-bottom:12px;">Menampilkan dari bulan saat ini hingga Desember ' + meta.currentYear + '. Data bulan lewat tahun ini juga ada di arsip tahun depan.</div>'
                : '');

        body.innerHTML = `
            <!-- Year selector + type tabs -->
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <button onclick="changePipelineYear(-1)" ${canPrev ? '' : 'disabled'}
                        style="padding:6px 10px;border:1px solid #EDE8E3;background:#fff;border-radius:6px;cursor:${canPrev ? 'pointer' : 'not-allowed'};opacity:${canPrev ? '1' : '0.4'};font-size:13px;">◀</button>
                    <div style="font-weight:700;font-size:18px;color:#1A1412;padding:0 8px;display:flex;align-items:center;">
                        ${pipelineState.year}${yearBadge}
                    </div>
                    <button onclick="changePipelineYear(1)" ${canNext ? '' : 'disabled'}
                        style="padding:6px 10px;border:1px solid #EDE8E3;background:#fff;border-radius:6px;cursor:${canNext ? 'pointer' : 'not-allowed'};opacity:${canNext ? '1' : '0.4'};font-size:13px;">▶</button>
                </div>
                <div style="display:flex;gap:4px;background:#F5F3F0;border-radius:8px;padding:3px;">
                    <button onclick="switchPipelineType('success')" style="padding:6px 14px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;background:${type === 'success' ? '#fff' : 'transparent'};color:${type === 'success' ? '#1A1412' : '#8C8078'};box-shadow:${type === 'success' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'};">Sukses</button>
                    <button onclick="switchPipelineType('omzet')" style="padding:6px 14px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;background:${type === 'omzet' ? '#fff' : 'transparent'};color:${type === 'omzet' ? '#1A1412' : '#8C8078'};box-shadow:${type === 'omzet' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'};">Omzet</button>
                </div>
            </div>
            ${archiveNotice}
            ${tableHtml}
        `;
    }

    window.closePipelineModal = function() {
        document.getElementById('pipelineModal').classList.remove('show');
    };

    // ============================================
    // GOOGLE CONTACTS INTEGRATION
    // ============================================

    async function checkGoogleStatus() {
        try {
            const resp = await fetch(`${API_URL}/google/status`, {
                credentials: 'include'
            });
            const data = await resp.json();
            const indicator = document.getElementById('googleIndicator');
            const statusText = document.getElementById('googleStatusText');
            const connectBtn = document.getElementById('googleConnectBtn');
            const disconnectBtn = document.getElementById('googleDisconnectBtn');

            const resyncBtn = document.getElementById('googleResyncBtn');
            if (data.connected) {
                indicator.style.background = '#16A34A';
                statusText.textContent = 'Terhubung — kontak customer otomatis tersimpan ke Google Contacts';
                statusText.style.color = '#16A34A';
                connectBtn.style.display = 'none';
                disconnectBtn.style.display = 'inline-block';
                if (resyncBtn) resyncBtn.style.display = 'inline-block';
            } else {
                indicator.style.background = '#DC2626';
                statusText.textContent = 'Belum terhubung';
                statusText.style.color = '#DC2626';
                connectBtn.style.display = 'inline-block';
                disconnectBtn.style.display = 'none';
                if (resyncBtn) resyncBtn.style.display = 'none';
            }
        } catch (err) {
            console.warn('Google status check failed:', err);
            const indicator = document.getElementById('googleIndicator');
            const statusText = document.getElementById('googleStatusText');
            const connectBtn = document.getElementById('googleConnectBtn');
            if (indicator) indicator.style.background = '#ccc';
            if (statusText) {
                statusText.textContent = 'Tidak bisa cek status';
                statusText.style.color = '#5C534B';
            }
            if (connectBtn) connectBtn.style.display = 'inline-block';
        }
    }

    window.connectGoogle = function() {
        window.location.href = `${API_URL}/google/auth`;
    };

    window.disconnectGoogle = async function() {
        if (!confirm('Putuskan Google Contacts? Kontak baru tidak akan otomatis tersimpan.')) return;
        try {
            // Use apiCall so the X-CSRF-Token header is included — backend rejects
            // bare POST with 403 since cookie-based auth requires CSRF double-submit.
            const result = await apiCall('/google/disconnect', { method: 'POST' });
            if (result && result.success === false) {
                alert('Gagal memutuskan: ' + (result.message || 'unknown'));
            }
            checkGoogleStatus();
        } catch (err) {
            alert('Gagal memutuskan: ' + err.message);
        }
    };

    window.resyncGoogleContacts = async function() {
        if (!confirm('Simpan ulang kontak customer yang gagal tersimpan ke Google Contacts? (hanya yang pending/gagal)')) return;
        const resultDiv = document.getElementById('googleResyncResult');
        const btn = document.getElementById('googleResyncBtn');
        btn.disabled = true;
        btn.textContent = 'Syncing...';
        resultDiv.style.display = 'block';
        resultDiv.textContent = 'Memproses kontak yang gagal tersimpan, mohon tunggu...';
        try {
            const data = await apiCall('/google/resync', { method: 'POST' });
            if (data.total === 0) {
                resultDiv.innerHTML = 'Tidak ada kontak yang pending — semua sudah tersimpan di Google Contacts.';
                resultDiv.style.color = '#16a34a';
            } else {
                resultDiv.innerHTML = `Selesai: <b>${data.saved}</b> tersimpan, <b>${data.failed}</b> gagal dari <b>${data.total}</b> kontak pending`;
                resultDiv.style.color = data.failed > 0 ? '#DC2626' : '#16a34a';
            }
        } catch (err) {
            resultDiv.textContent = 'Gagal re-sync: ' + err.message;
            resultDiv.style.color = '#DC2626';
        }
        btn.disabled = false;
        btn.textContent = 'Re-sync Kontak';
    };

    // Check for Google OAuth redirect result
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('google') === 'connected') {
        alert('Google Contacts berhasil terhubung! Kontak customer baru akan otomatis tersimpan.');
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('google') === 'error') {
        alert('Gagal menghubungkan Google: ' + (urlParams.get('msg') || 'Unknown error'));
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    checkGoogleStatus();

    // ============================================
    // SETTINGS PAGE — Akun Saya + Manajemen Admin
    // ============================================

    let currentAdminInfo = null;

    async function fetchCurrentAdmin() {
        const res = await apiCall('/admin/me');
        if (res && res.success) {
            currentAdminInfo = res.data;
            // Show email-missing banner globally if no email yet
            const banner = document.getElementById('emailMissingBanner');
            if (banner) banner.style.display = currentAdminInfo.email ? 'none' : 'block';
        }
        return currentAdminInfo;
    }

    async function loadSettingsPage() {
        const me = await fetchCurrentAdmin();
        if (!me) return;
        document.getElementById('myUsername').value = me.username || '';
        document.getElementById('myNama').value = me.nama || '';
        document.getElementById('myEmail').value = me.email || '';
        const badge = document.getElementById('myRoleBadge');
        if (me.role === 'owner') {
            badge.textContent = 'Owner';
            badge.style.background = 'rgba(185,28,28,0.08)';
            badge.style.color = '#B91C1C';
        } else {
            badge.textContent = 'Staff';
            badge.style.background = 'rgba(107,114,128,0.1)';
            badge.style.color = '#6B7280';
        }

        // Manajemen admin (owner-only)
        const mgmtCard = document.getElementById('adminMgmtCard');
        if (me.role === 'owner') {
            mgmtCard.style.display = 'block';
            await loadAdminList();
        } else {
            mgmtCard.style.display = 'none';
        }
    }

    async function loadAdminList() {
        const container = document.getElementById('adminListContainer');
        container.innerHTML = '<div class="loading">Memuat daftar admin...</div>';
        const res = await apiCall('/admin/admins');
        if (!res || !res.success) {
            container.innerHTML = '<div class="no-data">Gagal memuat daftar admin</div>';
            return;
        }
        const admins = res.data || [];
        const max = res.max || 3;
        document.getElementById('adminCountBadge').textContent = `${admins.length} / ${max}`;
        document.getElementById('addAdminBtn').disabled = admins.length >= max;
        document.getElementById('addAdminBtn').style.opacity = admins.length >= max ? '0.5' : '1';
        document.getElementById('addAdminBtn').title = admins.length >= max ? `Maksimal ${max} admin` : '';

        if (admins.length === 0) {
            container.innerHTML = '<div class="no-data">Belum ada admin</div>';
            return;
        }

        const isMe = (id) => currentAdminInfo && currentAdminInfo.id === id;
        const rows = admins.map(a => {
            const roleBadge = a.role === 'owner'
                ? '<span style="background:rgba(185,28,28,0.08);color:#B91C1C;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;">Owner</span>'
                : '<span style="background:rgba(107,114,128,0.1);color:#6B7280;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;">Staff</span>';
            const meTag = isMe(a.id) ? '<span style="font-size:10px;color:#2563EB;font-weight:600;margin-left:6px;">(Anda)</span>' : '';
            const canDelete = a.role !== 'owner' && !isMe(a.id);
            const editBtn = `<button class="btn-small" onclick="openEditAdminModal(${a.id})" style="font-size:11px;padding:5px 12px;">Edit</button>`;
            const delBtn = canDelete
                ? `<button class="btn-small" onclick="deleteAdmin(${a.id}, '${(a.nama || a.username).replace(/'/g, "\\'")}')" style="font-size:11px;padding:5px 12px;background:rgba(185,28,28,0.08);color:#B91C1C;border-color:rgba(185,28,28,0.2);">Hapus</button>`
                : '';
            return `<tr style="border-bottom:1px solid #F5F3F0;">
                <td style="padding:12px 8px;font-weight:600;">${a.username}${meTag}</td>
                <td style="padding:12px 8px;">${a.nama || '-'}</td>
                <td style="padding:12px 8px;color:${a.email ? '#1A1412' : '#B91C1C'};font-size:13px;">${a.email || '<em>belum diisi</em>'}</td>
                <td style="padding:12px 8px;">${roleBadge}</td>
                <td style="padding:12px 8px;text-align:right;display:flex;gap:6px;justify-content:flex-end;">${editBtn}${delBtn}</td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead><tr style="background:#FAFAF8;">
                        <th style="text-align:left;padding:10px 8px;font-size:11px;color:#8C8078;font-weight:600;text-transform:uppercase;">Username</th>
                        <th style="text-align:left;padding:10px 8px;font-size:11px;color:#8C8078;font-weight:600;text-transform:uppercase;">Nama</th>
                        <th style="text-align:left;padding:10px 8px;font-size:11px;color:#8C8078;font-weight:600;text-transform:uppercase;">Email</th>
                        <th style="text-align:left;padding:10px 8px;font-size:11px;color:#8C8078;font-weight:600;text-transform:uppercase;">Role</th>
                        <th style="text-align:right;padding:10px 8px;font-size:11px;color:#8C8078;font-weight:600;text-transform:uppercase;">Aksi</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    // Profile form submit
    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nama = document.getElementById('myNama').value.trim();
            const email = document.getElementById('myEmail').value.trim();
            if (!email) { alert('Email wajib diisi'); return; }
            const res = await apiCall('/admin/profile', {
                method: 'PATCH',
                body: JSON.stringify({ nama, email })
            });
            if (res && res.success) {
                alert('Profil tersimpan');
                await fetchCurrentAdmin();
                if (currentAdminInfo && currentAdminInfo.role === 'owner') await loadAdminList();
            } else {
                alert('Gagal: ' + (res?.message || 'Error'));
            }
        });
    }

    // Password form submit
    const pwForm = document.getElementById('passwordForm');
    if (pwForm) {
        pwForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const cur = document.getElementById('curPassword').value;
            const np = document.getElementById('newPassword').value;
            const npc = document.getElementById('newPasswordConfirm').value;
            if (np !== npc) { alert('Konfirmasi password tidak cocok'); return; }
            // Mirror server-side complexity rule so we fail fast in the UI
            if (np.length < 8 || !/[A-Za-z]/.test(np) || !/[0-9]/.test(np)) {
                alert('Password baru minimal 8 karakter, harus mengandung huruf dan angka');
                return;
            }
            const res = await apiCall('/admin/credentials', {
                method: 'PATCH',
                body: JSON.stringify({ current_password: cur, new_password: np })
            });
            if (res && res.success) {
                alert('Password berhasil diubah');
                // Server already rotated the auth cookie + CSRF token in its response —
                // no JWT to stash client-side anymore.
                pwForm.reset();
            } else {
                alert('Gagal: ' + (res?.message || 'Error'));
            }
        });
    }

    // Add/Edit admin modal
    window.openAddAdminModal = function() {
        document.getElementById('adminModalTitle').textContent = 'Tambah Admin';
        document.getElementById('adminFormId').value = '';
        document.getElementById('adminForm').reset();
        document.getElementById('adminFormPasswordRequired').style.display = 'inline';
        document.getElementById('adminFormPassword').required = true;
        document.getElementById('adminFormPasswordHint').textContent = 'Min 6 karakter.';
        document.getElementById('adminFormUsername').disabled = false;
        document.getElementById('adminFormError').style.display = 'none';
        document.getElementById('adminModal').classList.add('show');
    };

    window.openEditAdminModal = async function(id) {
        const res = await apiCall('/admin/admins');
        if (!res || !res.success) return;
        const a = (res.data || []).find(x => x.id === id);
        if (!a) return;
        document.getElementById('adminModalTitle').textContent = 'Edit Admin: ' + a.username;
        document.getElementById('adminFormId').value = a.id;
        document.getElementById('adminFormUsername').value = a.username;
        document.getElementById('adminFormUsername').disabled = true;
        document.getElementById('adminFormNama').value = a.nama || '';
        document.getElementById('adminFormEmail').value = a.email || '';
        document.getElementById('adminFormPassword').value = '';
        document.getElementById('adminFormPassword').required = false;
        document.getElementById('adminFormPasswordRequired').style.display = 'none';
        document.getElementById('adminFormPasswordHint').textContent = 'Kosongkan jika tidak ingin diubah.';
        document.getElementById('adminFormError').style.display = 'none';
        document.getElementById('adminModal').classList.add('show');
    };

    window.closeAdminModal = function() {
        document.getElementById('adminModal').classList.remove('show');
    };

    const adminBtn = document.getElementById('addAdminBtn');
    if (adminBtn) adminBtn.addEventListener('click', () => window.openAddAdminModal());

    const adminForm = document.getElementById('adminForm');
    if (adminForm) {
        adminForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const errEl = document.getElementById('adminFormError');
            errEl.style.display = 'none';
            const id = document.getElementById('adminFormId').value;
            const username = document.getElementById('adminFormUsername').value.trim();
            const nama = document.getElementById('adminFormNama').value.trim();
            const email = document.getElementById('adminFormEmail').value.trim();
            const password = document.getElementById('adminFormPassword').value;

            let res;
            if (id) {
                const body = { nama, email };
                if (password) body.password = password;
                res = await apiCall(`/admin/admins/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
            } else {
                res = await apiCall('/admin/admins', {
                    method: 'POST',
                    body: JSON.stringify({ username, nama, email, password })
                });
            }

            if (res && res.success) {
                window.closeAdminModal();
                await loadAdminList();
            } else {
                errEl.textContent = res?.message || 'Gagal menyimpan admin';
                errEl.style.display = 'block';
            }
        });
    }

    window.deleteAdmin = async function(id, label) {
        if (!confirm(`Hapus admin "${label}"? Tindakan ini tidak bisa dibatalkan.`)) return;
        const res = await apiCall(`/admin/admins/${id}`, { method: 'DELETE' });
        if (res && res.success) {
            await loadAdminList();
        } else {
            alert('Gagal: ' + (res?.message || 'Error'));
        }
    };

    // ============================================
    // INITIAL LOAD
    // ============================================

    loadDashboard();
    loadCleanupBanner();
    checkWADisconnectBanner();
    fetchCurrentAdmin();
}

console.log('✅ Admin Panel initialized');
console.log('📡 API URL:', API_URL);