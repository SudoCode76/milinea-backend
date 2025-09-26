const fs = require('fs');
const path = require('path');

const VAR_DIR = path.join(__dirname, '..', '..', 'var');
if (!fs.existsSync(VAR_DIR)) {
    try { fs.mkdirSync(VAR_DIR); } catch (_) {}
}
const FILE = path.join(VAR_DIR, 'data_unresolved_terms.json');

let unresolved = {};

function normalize(s) {
    return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function registerUnresolved(label) {
    const key = normalize(label);
    if (!key) return;
    const now = Date.now();
    if (!unresolved[key]) {
        unresolved[key] = { hits: 1, last_seen: now, original_samples: [label] };
    } else {
        unresolved[key].hits++;
        unresolved[key].last_seen = now;
        if (!unresolved[key].original_samples.includes(label) &&
            unresolved[key].original_samples.length < 5) {
            unresolved[key].original_samples.push(label);
        }
    }
}

function listUnresolved({ minHits = 2 } = {}) {
    return Object.entries(unresolved)
        .filter(([, v]) => v.hits >= minHits)
        .sort((a, b) => b[1].hits - a[1].hits)
        .map(([k, v]) => ({ key: k, ...v }));
}

function purgeUnresolvedOld(maxAgeDays = 30) {
    const now = Date.now();
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    for (const [k, v] of Object.entries(unresolved)) {
        if (now - v.last_seen > maxAge) delete unresolved[k];
    }
}

function loadUnresolvedCache() {
    try {
        if (fs.existsSync(FILE)) {
            const raw = fs.readFileSync(FILE, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data?.data)) {
                unresolved = {};
                for (const item of data.data) {
                    unresolved[item.key] = {
                        hits: item.hits || 1,
                        last_seen: item.last_seen || Date.now(),
                        original_samples: item.original_samples || [item.key]
                    };
                }
            }
        }
    } catch (_) {}
}

let persistTimer = null;
function schedulePersistUnresolved() {
    if (persistTimer) return;
    persistTimer = setInterval(() => {
        try {
            const dump = {
                updated: Date.now(),
                data: Object.entries(unresolved).map(([k, v]) => ({ key: k, ...v }))
            };
            fs.writeFileSync(FILE, JSON.stringify(dump, null, 2));
        } catch (_) {}
    }, 25000);
}

module.exports = {
    registerUnresolved,
    listUnresolved,
    purgeUnresolvedOld,
    loadUnresolvedCache,
    schedulePersistUnresolved
};