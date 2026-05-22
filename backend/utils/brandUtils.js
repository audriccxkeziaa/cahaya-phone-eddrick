// ============================================
// BRAND NORMALIZER
// Smart parser: extract valid brand + clean model from messy free-text input
// 8 known brands only (no Vivo, Huawei, Lainnya)
// ============================================

const BRAND_ALIASES = {
    iphone:   'iPhone',
    apple:    'iPhone',
    samsung:  'Samsung',
    xiaomi:   'Xiaomi',
    redmi:    'Xiaomi',
    poco:     'Xiaomi',
    mi:       'Xiaomi',
    oppo:     'Oppo',
    tecno:    'Tecno',
    realme:   'Realme',
    infinix:  'Infinix',
    nokia:    'Nokia',
};

const KNOWN_BRANDS = ['iPhone', 'Samsung', 'Xiaomi', 'Oppo', 'Tecno', 'Realme', 'Infinix', 'Nokia'];

const VALID_MODEL_QUALIFIERS = new Set([
    'pro', 'max', 'ultra', 'plus', 'lite', 'mini', 'note', 'edge', 'fold', 'flip',
    'neo', 'fe', 'se', 'air', 'play', 'prime', 'star', 'spark', 'hot', 'smart',
    'reno', 'find', 'pova', 'camon', 'narzo', 'gt',
    'pad', 'tab', 'book', '5g', '4g', 'lte', 'galaxy'
]);

const NOISE_WORDS = new Set([
    'lainnya', 'dll', 'dsb', 'etc', 'dst', 'misalnya', 'misal',
    'hp', 'handphone', 'phone', 'smartphone', 'unit', 'merk', 'merek',
    'tipe', 'type', 'model', 'series', 'seri', 'baru', 'lama', 'second', 'bekas',
    'new', 'used', 'ori', 'original', 'kw', 'replika',
    'bla', 'blabla', 'apa', 'apapun', 'sembarang', 'random', 'test', 'coba'
]);

/**
 * Detect brand from free text. Tries to match aliases at any position.
 * @returns canonical brand name or null
 */
function detectBrand(text) {
    if (!text) return null;
    const tokens = String(text).toLowerCase().split(/[\s\-_,./]+/).filter(Boolean);
    for (const tok of tokens) {
        if (BRAND_ALIASES[tok]) return BRAND_ALIASES[tok];
    }
    return null;
}

/**
 * Check if a token looks like a valid model part:
 *  - has at least one digit (e.g., "15", "s23", "a14", "note10")
 *  - OR is a known qualifier (pro, max, ultra, etc.)
 *  - excludes noise words
 *  - excludes single random letters (a, b, c) UNLESS followed by digits
 */
function isValidModelToken(token) {
    if (!token) return false;
    const lower = token.toLowerCase();

    if (NOISE_WORDS.has(lower)) return false;

    if (VALID_MODEL_QUALIFIERS.has(lower)) return true;

    if (/\d/.test(lower)) return true;

    if (lower.length === 1) return false;

    if (lower.length >= 3 && /^[a-z]+$/.test(lower)) {
        return false;
    }

    return false;
}

/**
 * Capitalize a model token sensibly:
 *  - "s23" → "S23", "a14" → "A14", "note10" → "Note10"
 *  - "pro" → "Pro", "max" → "Max"
 */
function formatModelToken(token) {
    const lower = token.toLowerCase();
    if (/^[a-z]+\d/.test(lower)) {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    }
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Strip the brand alias from model text and clean up noise.
 *  - "samsung s23 ultra lainnya" + brand=Samsung → "S23 Ultra"
 *  - "iphone 17 a"   + brand=iPhone  → "17"
 *  - "redmi note 12" + brand=Xiaomi  → "Note 12"
 */
function cleanModel(rawText, detectedBrand) {
    if (!rawText) return '';
    let tokens = String(rawText).split(/[\s,]+/).filter(Boolean);

    const merged = [];
    for (let i = 0; i < tokens.length; i++) {
        const cur = tokens[i];
        const next = tokens[i + 1];
        if (cur && cur.length === 1 && /^[a-z]$/i.test(cur) && next && /^\d/.test(next)) {
            merged.push(cur + next);
            i++;
        } else {
            merged.push(cur);
        }
    }
    tokens = merged;

    const cleaned = [];
    for (const tok of tokens) {
        const lower = tok.toLowerCase();

        if (BRAND_ALIASES[lower]) continue;

        if (!isValidModelToken(tok)) continue;

        cleaned.push(formatModelToken(tok));
    }

    return cleaned.join(' ').trim();
}

/**
 * Main normalizer.
 *
 * Input:
 *   { merk_unit: "Lainnya" | "Samsung" | ... | null,
 *     tipe_unit: "samsung s23 ultra lainnya" | "iphone 17 a" | ... | null }
 *
 * Output:
 *   { merk_unit: "Samsung" | "iPhone" | ... | null,   // canonical 8-brand or null if undetectable
 *     tipe_unit: "S23 Ultra" | "17" | ... | null,     // cleaned model, brand stripped, noise removed
 *     normalized: bool }                              // true if anything was changed
 */
function normalizeBrandAndModel(merk_unit, tipe_unit) {
    const merkRaw = merk_unit ? String(merk_unit).trim() : '';
    const tipeRaw = tipe_unit ? String(tipe_unit).trim() : '';

    let brand = detectBrand(merkRaw);

    if (!brand) {
        brand = detectBrand(tipeRaw);
    }

    if (!brand && KNOWN_BRANDS.includes(merkRaw)) {
        brand = merkRaw;
    }

    const model = cleanModel(tipeRaw, brand);

    const finalMerk = brand || null;
    const finalTipe = model || null;

    const changed = (finalMerk !== (merk_unit || null)) || (finalTipe !== (tipe_unit || null));

    return {
        merk_unit: finalMerk,
        tipe_unit: finalTipe,
        normalized: changed
    };
}

module.exports = {
    KNOWN_BRANDS,
    BRAND_ALIASES,
    detectBrand,
    cleanModel,
    normalizeBrandAndModel
};
