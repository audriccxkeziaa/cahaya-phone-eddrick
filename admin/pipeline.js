/* Monthly purchase monitoring. Loaded before admin.js. */
function initializePipelineReports(apiCall, esc) {
    const state = { year: null, type: 'success', report: null, month: null, detail: null, request: 0 };
    const body = () => document.getElementById('pipelineModalBody');
    const money = value => new Intl.NumberFormat('id-ID', {
        style: 'currency', currency: 'IDR', maximumFractionDigits: 0
    }).format(Number(value) || 0);
    const monthLabel = month => new Date(month + '-01T00:00:00+08:00').toLocaleDateString('id-ID', {
        month: 'long', year: 'numeric', timeZone: 'Asia/Makassar'
    });
    const dateLabel = value => new Date(value).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar'
    });

    async function loadYear(year) {
        const request = ++state.request;
        state.month = null;
        state.detail = null;
        body().innerHTML = '<div class="loading" role="status">Memuat laporan bulanan...</div>';
        const result = await apiCall(`/admin/pipeline/monthly?year=${year || ''}`);
        if (request !== state.request) return;
        if (!result?.success) {
            body().innerHTML = '<div class="no-data">Gagal memuat laporan. <button class="btn-small" onclick="showPipelineDetail()">Coba lagi</button></div>';
            return;
        }
        state.report = result;
        state.year = result.meta.year;
        render();
    }

    window.showPipelineDetail = function(type) {
        state.type = type || state.type;
        document.getElementById('pipelineModal').classList.add('show');
        document.getElementById('pipelineModalTitle').textContent = state.type === 'omzet' ? 'Detail Omzet Per Bulan' : 'Detail Transaksi Sukses Per Bulan';
        // Reopening always refreshes: new purchases and corrections must appear.
        const year = state.year || new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Makassar' }).format(new Date());
        return loadYear(year);
    };
    window.closePipelineModal = function() {
        ++state.request;
        document.getElementById('pipelineModal').classList.remove('show');
    };
    window.changePipelineYear = function(direction) {
        const years = state.report?.meta.availableYears || [];
        // Years are descending; the left arrow moves to the next, older entry.
        const index = years.indexOf(state.year) - direction;
        if (index >= 0 && index < years.length) return loadYear(years[index]);
    };
    window.switchPipelineType = function(type) {
        state.type = type;
        render();
    };
    window.backToPipelineYear = function() {
        ++state.request;
        state.month = null;
        state.detail = null;
        render();
    };
    window.showPipelineMonth = async function(month, page = 1) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
        const request = ++state.request;
        state.month = month;
        state.detail = null;
        render();
        const result = await apiCall(`/admin/pipeline/detail?month=${month}&page=${page}`);
        if (request !== state.request) return;
        state.detail = result?.success ? result : { error: true };
        render();
    };

    function renderDetail() {
        const detail = state.detail;
        let html = `<button class="btn-small pipeline-back" onclick="backToPipelineYear()">&larr; Semua bulan ${state.year}</button>
            <h3 class="pipeline-month-title">${monthLabel(state.month)}</h3>
            <p class="pipeline-note">Riwayat pembelian berdasarkan tanggal transaksi (WITA), termasuk pembelian ulang.</p>`;
        if (!detail) return html + '<div class="loading" role="status">Memuat detail pembelian...</div>';
        if (detail.error) return html + `<div class="no-data">Gagal memuat detail. <button class="btn-small" onclick="showPipelineMonth('${state.month}')">Coba lagi</button></div>`;
        const { summary, meta, data } = detail;
        html += `<div class="pipeline-summary">
            <div><small>Omzet</small><strong>${money(summary.omzet)}</strong></div>
            <div><small>Transaksi</small><strong>${summary.transactions}</strong></div>
            <div><small>Customer belanja</small><strong>${summary.buyers}</strong></div>
            <div><small>Unit</small><strong>${summary.units}</strong></div>
        </div>`;
        if (!data.length) return html + '<div class="no-data">Belum ada pembelian pada bulan ini.</div>';
        html += `<p class="pipeline-mobile-hint">Geser tabel untuk melihat semua kolom &rarr;</p><div class="pipeline-table-wrap" tabindex="0" aria-label="Rincian transaksi"><table class="pipeline-table pipeline-purchases"><thead><tr>
            <th>Tanggal (WITA)</th><th>Customer</th><th>Produk</th><th>Qty</th><th>Subtotal</th><th>Sales / Pembayaran</th>
            </tr></thead><tbody>${data.map(p => `<tr>
                <td>${dateLabel(p.purchased_at)}</td>
                <td><strong>${esc(p.nama_lengkap || '-')}</strong><small>${esc(p.whatsapp || '-')}</small></td>
                <td>${esc([p.merk_unit, p.tipe_unit].filter(Boolean).join(' ') || '-')}</td>
                <td>${p.qty}</td><td class="pipeline-money">${money(p.subtotal)}</td>
                <td>${esc(p.nama_sales || '-')}<small>${esc(p.metode_pembayaran || '-')}</small></td>
            </tr>`).join('')}</tbody></table></div>
            <div class="pipeline-pagination">
                <button class="btn-small" ${meta.page <= 1 ? 'disabled' : ''} onclick="showPipelineMonth('${state.month}', ${meta.page - 1})">&larr; Sebelumnya</button>
                <span>Halaman ${meta.page} / ${meta.totalPages} &middot; ${summary.transactions} transaksi</span>
                <button class="btn-small" ${meta.page >= meta.totalPages ? 'disabled' : ''} onclick="showPipelineMonth('${state.month}', ${meta.page + 1})">Berikutnya &rarr;</button>
            </div>`;
        return html;
    }

    function render() {
        if (!state.report) return;
        document.getElementById('pipelineModalTitle').textContent = state.type === 'omzet' ? 'Detail Omzet Per Bulan' : 'Detail Transaksi Sukses Per Bulan';
        if (state.month) { body().innerHTML = renderDetail(); return; }
        const { data, meta } = state.report;
        const years = meta.availableYears;
        const index = years.indexOf(state.year);
        const omzet = state.type === 'omzet';
        const totals = data.reduce((s, m) => ({ omzet: s.omzet + Number(m.omzet), sukses: s.sukses + Number(m.sukses) }), { omzet: 0, sukses: 0 });
        body().innerHTML = `<div class="pipeline-toolbar">
            <div class="pipeline-years">
                <button class="btn-small" aria-label="Tahun sebelumnya" onclick="changePipelineYear(-1)" ${index >= years.length - 1 ? 'disabled' : ''}>&larr;</button>
                <strong>${state.year}</strong><span class="pipeline-year-badge">${meta.isArchive ? 'Arsip' : 'Aktif'}</span>
                <button class="btn-small" aria-label="Tahun berikutnya" onclick="changePipelineYear(1)" ${index <= 0 ? 'disabled' : ''}>&rarr;</button>
            </div>
            <div class="pipeline-tabs" aria-label="Jenis laporan">
                <button aria-pressed="${!omzet}" onclick="switchPipelineType('success')">Sukses</button>
                <button aria-pressed="${omzet}" onclick="switchPipelineType('omzet')">Omzet</button>
            </div></div>
            <p class="pipeline-note">Januari–Desember ${state.year}. Klik bulan untuk melihat tanggal, customer, dan rincian pembeliannya. Satu transaksi dihitung per catatan pembelian.</p>
            <p class="pipeline-mobile-hint">Geser tabel untuk melihat semua kolom &rarr;</p><div class="pipeline-table-wrap" tabindex="0" aria-label="Laporan semua bulan"><table class="pipeline-table"><thead><tr>
                <th>Bulan</th>${omzet ? '<th>Omzet</th><th>Transaksi</th>' : '<th>Transaksi sukses</th><th>Customer belanja</th><th>Customer baru</th>'}<th>Perubahan</th>
            </tr></thead><tbody>${data.map((m, i) => {
                const value = Number(omzet ? m.omzet : m.sukses);
                const prev = i ? Number(omzet ? data[i - 1].omzet : data[i - 1].sukses) : null;
                const diff = prev === null ? 0 : value - prev;
                let change = '—';
                if (diff !== 0 && prev !== null) {
                    change = omzet ? (prev ? `${diff > 0 ? '+' : ''}${(diff / prev * 100).toFixed(1)}%` : 'Baru') : `${diff > 0 ? '+' : ''}${diff}`;
                }
                return `<tr><td><button class="pipeline-month-link" onclick="showPipelineMonth('${m.bulan}')">${monthLabel(m.bulan)} <span aria-hidden="true">&rarr;</span></button></td>
                    ${omzet ? `<td class="pipeline-money">${money(m.omzet)}</td><td>${m.sukses}</td>` : `<td class="pipeline-count">${m.sukses}</td><td>${m.buyers}</td><td>${m.total}</td>`}
                    <td class="${diff > 0 ? 'pipeline-up' : diff < 0 ? 'pipeline-down' : ''}">${change}</td></tr>`;
            }).join('')}</tbody><tfoot><tr><th>Total ${state.year}</th>
                ${omzet ? `<td class="pipeline-money">${money(totals.omzet)}</td><td>${totals.sukses}</td><td></td>` : `<td>${totals.sukses}</td><td colspan="3"></td>`}
            </tr></tfoot></table></div>`;
    }
}

if (typeof module !== 'undefined') module.exports = { initializePipelineReports };
