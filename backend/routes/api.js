// ============================================
// API ROUTES
// ============================================

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

// Controllers
const formController = require('../controllers/formController');
const webhookController = require('../controllers/webhookController');
const adminController = require('../controllers/adminController');
const googleController = require('../controllers/googleController');
const birthdayController = require('../controllers/birthdayController');

// Middleware
const authMiddleware = require('../config/authMiddleware');
const { auditLog } = require('../config/auditLog');
const { addClient } = require('../config/realtime');

// SSE stream for realtime admin updates (cookie-authenticated, same as other admin
// routes). Frontend connects via EventSource{ withCredentials:true } and re-fetches
// the current view when a watched table changes. No-op events ("_ping") keep alive.
router.get('/admin/stream', authMiddleware, (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write('retry: 5000\n\n');
    addClient(res);
});

// Rate limiters for public endpoints
const formLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Terlalu banyak pengiriman form. Coba lagi dalam 15 menit.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true   // only failed logins count toward the limit
});

const forgotLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Terlalu banyak permintaan reset password. Coba lagi dalam 1 jam.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Reset (token redemption) — block brute force on the reset token endpoint.
const resetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Terlalu banyak percobaan reset. Coba lagi dalam 15 menit.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Webhook — even though it's now secret-gated, throttle to slow down credential-stuffing
// attempts if the secret ever leaks.
const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,                // 60 incoming webhook events per minute is well above any real burst
    message: { success: false, message: 'Webhook rate limit exceeded' },
    standardHeaders: true,
    legacyHeaders: false
});

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

// Customer form submission (rate limited)
router.post('/form-submit', formLimiter, formController.submitForm);

// WhatsApp webhook — incoming messages from wa-bridge (Baileys).
// Auth check is inside the handler (verifies X-WA-Secret); rate limit caps abuse.
router.post('/webhook/whatsapp', webhookLimiter, webhookController.handleWhatsAppWebhook);
router.get('/webhook/test', webhookController.testWebhook);

// Quick-sync contacts (protected by secret key in Authorization header)
router.get('/sync/contacts', adminController.quickSyncVCF);
router.get('/sync/list', adminController.quickSyncList);
router.post('/sync/contacts/selected', adminController.quickSyncSelected);

// Google Contacts OAuth
router.get('/google/auth', googleController.authorize);
router.get('/google/callback', googleController.callback);
router.get('/google/status', authMiddleware, googleController.status);
router.post('/google/disconnect', authMiddleware, googleController.disconnect);
router.post('/google/resync', authMiddleware, googleController.resync);

// Admin login (rate limited)
router.post('/admin/login', loginLimiter, adminController.login);

// Admin logout — clears auth + csrf cookies. Public so it works even if token expired.
router.post('/admin/logout', adminController.logout);

// Admin profile update (edit name + email)
router.patch('/admin/profile', authMiddleware, adminController.updateProfile);

// Admin change credentials (username/password)
router.patch('/admin/credentials', authMiddleware, adminController.changeCredentials);

// Current admin info (for role-based UI)
router.get('/admin/me', authMiddleware, adminController.getCurrentAdmin);

// Admin management (owner-only) — max 3 admins
router.get('/admin/admins', authMiddleware, adminController.listAdmins);
router.post('/admin/admins', authMiddleware, adminController.createAdmin);
router.patch('/admin/admins/:id', authMiddleware, adminController.updateAdmin);
router.delete('/admin/admins/:id', authMiddleware, adminController.deleteAdmin);

// Forgot password / reset (rate limited)
router.post('/admin/forgot', forgotLimiter, adminController.forgotPassword);
router.get('/admin/reset/validate', resetLimiter, adminController.validateResetToken);
router.post('/admin/reset', resetLimiter, adminController.resetPassword);

// ============================================
// PROTECTED ROUTES (Authentication required)
// ============================================

// Dashboard statistics
router.get('/admin/stats', authMiddleware, adminController.getStats);
router.get('/admin/pipeline/monthly', authMiddleware, adminController.getPipelineMonthly);

// Customers
router.get('/admin/customers', authMiddleware, adminController.getCustomers);
router.get('/admin/purchases/metadata', authMiddleware, adminController.getPurchaseMetadata);
router.get('/admin/customers/export', authMiddleware, adminController.exportContacts);
router.get('/admin/customers/export/vcf', authMiddleware, adminController.exportVCard);
router.patch('/admin/customers/:id/status', authMiddleware, auditLog('update_customer_status'), adminController.updateCustomerStatus);
router.patch('/admin/customers/:id/catatan', authMiddleware, auditLog('update_customer_catatan'), adminController.updateCustomerCatatan);
router.patch('/admin/customers/:id', authMiddleware, auditLog('update_customer'), adminController.updateCustomer);
router.put('/admin/customers/:id/purchases', authMiddleware, auditLog('update_customer_purchases'), adminController.saveCustomerPurchases);
router.get('/admin/customers/:id', authMiddleware, adminController.getCustomerById);
router.delete('/admin/customers/:id', authMiddleware, auditLog('delete_customer'), adminController.deleteCustomer);

// Messages
router.get('/admin/messages', authMiddleware, adminController.getMessages);
router.get('/admin/messages/:customerId', authMiddleware, adminController.getMessagesByCustomer);

// Analytics
router.get('/admin/analytics/top-buyers', authMiddleware, adminController.getTopBuyers);
router.get('/admin/analytics/top-products', authMiddleware, adminController.getTopProducts);
router.get('/admin/analytics/top-brands', authMiddleware, adminController.getTopBrands);

// Broadcast
router.post('/admin/broadcast/start', authMiddleware, auditLog('broadcast_start'), adminController.startBroadcast);
router.post('/admin/broadcast/process', authMiddleware, adminController.processBroadcast);
router.post('/admin/broadcast/stop', authMiddleware, auditLog('broadcast_stop'), adminController.stopBroadcast);
router.post('/admin/broadcast/pause', authMiddleware, auditLog('broadcast_pause'), adminController.pauseBroadcast);
router.post('/admin/broadcast/resume', authMiddleware, auditLog('broadcast_resume'), adminController.resumeBroadcast);
router.get('/admin/broadcast/status', authMiddleware, adminController.getBroadcastStatus);
router.get('/admin/broadcast/daily-count', authMiddleware, adminController.getDailySentCount);

// WA API routes (Fonnte)
router.get('/admin/wa/status', authMiddleware, adminController.getWABridgeStatus);
router.post('/admin/wa/auto-reply', authMiddleware, adminController.updateWAAutoReply);
router.get('/admin/wa/auto-reply', authMiddleware, adminController.getWAAutoReply);
router.post('/admin/wa/disconnect', authMiddleware, adminController.disconnectWA);
router.post('/admin/wa/restart', authMiddleware, adminController.restartWA);
router.post('/admin/wa/settings', authMiddleware, auditLog('update_wa_settings'), adminController.updateWASettings);
router.get('/admin/wa/failed', authMiddleware, adminController.getFailedWA);
router.post('/admin/wa/retry/:id', authMiddleware, adminController.retryWA);
router.post('/admin/wa/retry-all', authMiddleware, adminController.retryAllWA);
router.post('/admin/wa/reconcile-queue', authMiddleware, adminController.reconcileQueue);
router.get('/admin/wa/log', authMiddleware, adminController.getWAMessageLog);

// Birthday greetings
router.get('/admin/birthday/today', authMiddleware, birthdayController.getTodayBirthdays);
router.post('/admin/birthday/send', authMiddleware, birthdayController.sendGreeting);
router.post('/admin/birthday/send-all', authMiddleware, birthdayController.sendAllGreetings);
router.put('/admin/birthday/message', authMiddleware, birthdayController.updateMessage);
router.post('/admin/birthday/auto-send', authMiddleware, birthdayController.toggleAutoSend);
router.get('/admin/birthday/history', authMiddleware, birthdayController.getHistory);

// Data cleanup
router.get('/admin/cleanup/status', authMiddleware, adminController.getCleanupStatus);
router.get('/admin/cleanup/export', authMiddleware, adminController.exportOldLogs);
router.post('/admin/cleanup/delete', authMiddleware, auditLog('cleanup_delete'), adminController.deleteOldLogs);
// Monthly aggressive cleanup — wipes ALL logs, keeps customers/purchases/birthday
router.post('/admin/cleanup/monthly', authMiddleware, auditLog('monthly_cleanup'), adminController.monthlyCleanup);

// Full backup + resource monitoring
router.get('/admin/backup/full', authMiddleware, auditLog('full_backup'), adminController.fullBackup);
router.get('/admin/backup/status', authMiddleware, adminController.getBackupStatus);
router.get('/admin/resource-usage', authMiddleware, adminController.getResourceUsage);

// Audit trail
router.get('/admin/audit-log', authMiddleware, adminController.getAuditLog);

// Billing status — used by dashboard banner to show H-3 / H / overdue warning
router.get('/admin/billing-status', authMiddleware, adminController.getBillingStatus);

// App settings — global auto toggles
router.get('/admin/settings/auto-toggles', authMiddleware, adminController.getAutoToggles);
router.post('/admin/settings/auto-toggles', authMiddleware, auditLog('update_auto_toggle'), adminController.setAutoToggle);

module.exports = router;