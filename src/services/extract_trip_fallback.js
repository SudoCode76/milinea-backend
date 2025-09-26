/**
 * Fallback determinista para extraer origen/destino de una frase en español.
 * No cubre todos los casos, pero basta para "de X a Y" / "desde X a Y" / "ir a Y".
 */

function cleanSpaces(s) {
    return s.replace(/\s+/g, ' ').trim();
}

function stripOuterQuotes(s) {
    return s.replace(/^["'“”‘’]+/, '').replace(/["'“”‘’]+$/, '');
}

function removeLeadingArticles(s) {
    return s.replace(/^(?:de|del|la|el|los|las|al)\s+/i, '').trim();
}

function extractTrip(textRaw) {
    if (!textRaw) {
        return {
            origin_text: '',
            destination_text: '',
            intent: 'unknown',
            source: 'fallback'
        };
    }
    const text = textRaw.toLowerCase();

    // Patrón desde/de X a/hasta/hacia Y
    const regex = /\bdes(?:de)?\s+(.+?)\s+(?:a|hasta|hacia)\s+(.+)/i;
    const m = textRaw.match(regex);
    if (m) {
        const o = stripOuterQuotes(cleanSpaces(m[1]));
        const d = stripOuterQuotes(cleanSpaces(m[2]));
        if (o && d) {
            return {
                origin_text: removeLeadingArticles(o),
                destination_text: removeLeadingArticles(d),
                intent: 'route',
                source: 'fallback-pattern'
            };
        }
    }

    // "ir a X", "quiero ir a X", "llegar a X", "como llego a X"
    const oneDestRegex = /\b(?:ir|llegar|llevar|llego|voy|quiero ir|como llego)\s+(?:a|al|a la)\s+(.+)/i;
    const m2 = textRaw.match(oneDestRegex);
    if (m2) {
        const dest = stripOuterQuotes(cleanSpaces(m2[1]));
        return {
            origin_text: '',
            destination_text: removeLeadingArticles(dest),
            intent: 'route',
            source: 'fallback-destination-only'
        };
    }

    // "qué línea me lleva a X"
    const lineToRegex = /\b(?:que|qué)\s+linea\s+me\s+lleva\s+(?:a|al|a la)\s+(.+)/i;
    const m3 = textRaw.match(lineToRegex);
    if (m3) {
        const dest = stripOuterQuotes(cleanSpaces(m3[1]));
        return {
            origin_text: '',
            destination_text: removeLeadingArticles(dest),
            intent: 'route',
            source: 'fallback-line-to'
        };
    }

    return {
        origin_text: '',
        destination_text: '',
        intent: 'unknown',
        source: 'fallback-none'
    };
}

module.exports = { extractTrip };