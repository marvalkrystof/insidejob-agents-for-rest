import type { LoadedFile } from './files.ts';

export type AdvancePayment = {
    office: 'cssz' | 'vzp';
    date?: string;
    amount: number;
    source: string;
    counted: boolean;
    flags: string[];
};

// ČSSZ pension advances go to "01011-…/0710" (sickness insurance "11017-…" is a different payment).
const CSSZ = /\b01011-\d+|(?<!\p{L})[OČCP]SSZ(?!\p{L})|spr[aá]va soci[aá]ln[ií]ho zabezpe[cč]en[ií]/iu;
const CSSZ_SICKNESS = /\b11017-\d+/;
// VZP accounts at ČNB start with 111.
const VZP = /\b111\d{4,}\b.*0710|\bVZP\b|v[sš]eobecn[aá] zdravotn[ií] poji[sš][tť]ovna/i;

const DATE = /\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const ACCOUNT = /\b(?:\d{1,6}-)?\d{2,10}\/\d{4}\b|\b\d{1,6}-\d{2,10}\b/g;
const LONG_NUMBER = /\b\d{6,}\b/g;
const MONEY = /[-−]?\s?\d{1,3}(?:[  .]\d{3})+(?:,\d{2})?(?!\d)|[-−]?\d+[.,]\d{2}(?!\d)|[-−]?\d+(?=\s?(?:Kč|CZK))/g;

const parseDate = (line: string): string | undefined => {
    const m = DATE.exec(line);
    if (!m) return undefined;
    const [day, month, year] = m[1] ? [m[1], m[2], m[3]] : m[4] ? [m[6], m[5], m[4]] : [m[7], m[8], m[9]];
    return `${year}-${month?.padStart(2, '0')}-${day?.padStart(2, '0')}`;
};

const parseAmount = (line: string): number | undefined => {
    const cleaned = line.replace(new RegExp(DATE.source, 'g'), ' ').replace(ACCOUNT, ' ').replace(LONG_NUMBER, ' ');
    const amounts = [...cleaned.matchAll(MONEY)].map(([token]) => {
        const negative = /^[-−]/.test(token.trim());
        const normalized = token.replace(/[-−\s  ]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
        return { negative, value: Number(normalized) };
    }).filter(({ value }) => value > 0);

    return (amounts.find(({ negative }) => negative) ?? amounts[0])?.value;
};

/** Finds payments to ČSSZ and VZP in a bank statement (CSV or PDF text). Code only, the text never goes to AI. */
export const findAdvancePayments = (file: LoadedFile, year: number): AdvancePayment[] => {
    const payments: AdvancePayment[] = [];

    for (const line of file.text.split(/\r?\n/)) {
        const office = CSSZ.test(line) && !CSSZ_SICKNESS.test(line) ? 'cssz' : VZP.test(line) ? 'vzp' : undefined;
        if (!office) continue;

        const amount = parseAmount(line);
        if (amount === undefined) continue;

        const date = parseDate(line);
        const flags: string[] = [];
        if (!date) flags.push('No date found on this line.');
        else if (!date.startsWith(`${year}-`)) flags.push(`Paid outside ${year}.`);
        else if (date.slice(5, 7) === '01') flags.push(`January payment: it may be for December ${year - 1}.`);

        const previous = payments.at(-1);
        if (previous?.office === office && previous.date === date && previous.amount === amount) continue;

        const counted = !date || date.startsWith(`${year}-`);
        payments.push({ office, date, amount, source: file.name, counted, flags });
    }

    return payments;
};
