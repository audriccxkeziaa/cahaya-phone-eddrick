const db = require('./database');

function auditLog(action) {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);
        res.json = function (body) {
            if (res.statusCode < 400) {
                const adminId = req.admin?.id || null;
                const adminUsername = req.admin?.username || 'unknown';
                const detail = buildDetail(action, req);
                db.query(
                    `INSERT INTO admin_activity_logs (admin_id, admin_username, action, detail, ip_address)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [adminId, adminUsername, action, detail, req.ip]
                ).catch(err => console.warn('[Audit] Log failed:', err.message));
            }
            return originalJson(body);
        };
        next();
    };
}

function buildDetail(action, req) {
    const parts = [];
    if (req.params.id) parts.push(`target_id=${req.params.id}`);
    if (req.body.status) parts.push(`status=${req.body.status}`);
    if (req.body.template_name) parts.push(`template=${req.body.template_name}`);
    if (req.body.source_filter) parts.push(`filter=${req.body.source_filter}`);
    if (req.body.dailyLimit) parts.push(`limit=${req.body.dailyLimit}`);
    return parts.join(', ') || null;
}

module.exports = { auditLog };
