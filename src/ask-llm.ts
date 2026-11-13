import { log } from 'apify';

import type { Calculation, Language, YearParams } from './types.ts';

const FEATHERLESS_URL = 'https://api.featherless.ai/v1/chat/completions';
const MODEL = 'Qwen/Qwen3.8-27B';

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
    'and the scope. Rules:',
    '1. Answer only from the provided rows, trace and sources.',
    'Cite the row (e.g. "DPFO ř. 56") or source URL you rely on.',
    '2. If the answer is not covered by the provided material, say "Not covered by this tool" and suggest the office',
    'or a daňový poradce. Never guess numbers, limits, dates or rules.',
    '3. Never recalculate or change any number. Quote values from the trace.',
    `4. If the notes describe a situation outside this scope, list it under "Unsupported situations": ${SCOPE}`,
    '5. Use plain language, short paragraphs, and keep official Czech terms in parentheses.',
].join('\n');

type ChatCompletion = {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
};

export const askLlm = async (
    notes: string,
    params: YearParams,
    calculation: Calculation,
    language: Language,
): Promise<string | null> => {
    if (!process.env.FEATHERLESS_API_KEY) {
        log.warning('FEATHERLESS_API_KEY is not set, skipping the questions section.');
        return null;
    }

    const material = JSON.stringify({ year: params.year, rows: params.rows, trace: calculation.trace });
    const response = await fetch(FEATHERLESS_URL, {
        signal: AbortSignal.timeout(180_000),
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.FEATHERLESS_API_KEY}`,
            'Content-Type': 'application/json',
            'X-Title': 'OSVC Forms Helper',
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 8192,
            temperature: 0.2,
            messages: [
                { role: 'system', content: SYSTEM },
                {
                    role: 'user',
                    content: `Answer in ${language === 'cs' ? 'Czech' : 'English'}.\n\n`
                        + `<material>${material}</material>\n\n<notes>${notes}</notes>`,
                },
            ],
        }),
    }).catch((error: unknown) => {
        log.warning(`Featherless request failed: ${String(error)}`);
        return null;
    });

    if (!response) return null;
    if (!response.ok) {
        log.warning(`Featherless request failed (${response.status}): ${await response.text()}`);
        return null;
    }

    const choice = ((await response.json()) as ChatCompletion).choices?.[0];
    if (choice?.finish_reason === 'length') log.warning('The answer was cut off at max_tokens.');

    return choice?.message?.content?.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '') ?? null;
};
