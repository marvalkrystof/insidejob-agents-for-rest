import { chatCompletion } from './featherless.ts';
import type { Calculation, Language, YearParams } from './types.ts';

const SCOPE = [
    'Supported: Czech OSVČ, full calendar year, only §7 business income, main or secondary activity,',
    'flat-rate or actual expenses, sleva na poplatníka, daňové zvýhodnění for children claimed for the whole year,',
    'health insurer VZP. Not supported: §6 employment income in the same return, §8/§9/§10 income, foreign income,',
    'spolupracující osoba, activity for only part of the year, odpočty (mortgage interest, pension savings, gifts),',
    'paušální daň, DPH (VAT), other health insurers\' form rows, a loss (ztráta).',
].join(' ');

const SYSTEM = [
    'You answer questions from a Czech self-employed person (OSVČ) about their annual filings.',
    'You are given the approved form rows with their official instructions (pokyny), the calculation trace,',
    'the filing and payment deadlines, and the scope. Rules:',
    '1. Answer only from the provided rows, trace and sources.',
    'Cite the row (e.g. "DPFO ř. 56") or source URL you rely on.',
    '2. If the answer is not covered by the provided material, say "Not covered by this tool" and suggest the office',
    'or a daňový poradce. Never guess numbers, limits, dates or rules.',
    '3. Never recalculate or change any number. Quote values from the trace.',
    `4. If the notes describe a situation outside this scope, list it under "Unsupported situations": ${SCOPE}`,
    '5. Use plain language, short paragraphs, and keep official Czech terms in parentheses.',
].join('\n');

export const askLlm = async (
    notes: string,
    params: YearParams,
    calculation: Calculation,
    language: Language,
): Promise<string | null> => {
    const material = JSON.stringify({
        year: params.year,
        rows: params.rows,
        trace: calculation.trace,
        deadlines: params.deadlines,
    });

    return chatCompletion([
        { role: 'system', content: SYSTEM },
        {
            role: 'user',
            content: `Answer in ${language === 'cs' ? 'Czech' : 'English'}.\n\n`
                + `<material>${material}</material>\n\n<notes>${notes}</notes>`,
        },
    ], 8192);
};
