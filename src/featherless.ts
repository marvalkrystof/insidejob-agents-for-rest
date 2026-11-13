import { log } from 'apify';

const FEATHERLESS_URL = 'https://api.featherless.ai/v1/chat/completions';
const MODEL = 'Qwen/Qwen3.8-27B';

type ChatMessage = { role: 'system' | 'user'; content: string };

type ChatCompletion = {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
};

/** Returns the model's text answer, or null when the key is missing or the request fails. */
export const chatCompletion = async (messages: ChatMessage[], maxTokens: number): Promise<string | null> => {
    if (!process.env.FEATHERLESS_API_KEY) {
        log.warning('FEATHERLESS_API_KEY is not set, skipping the AI step.');
        return null;
    }

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
            max_tokens: maxTokens,
            temperature: 0.2,
            // Hidden reasoning could use up max_tokens before any answer is written, so it is off.
            chat_template_kwargs: { enable_thinking: false },
            messages,
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
    if (choice?.finish_reason === 'length') log.warning('The AI answer was cut off at max_tokens.');

    return choice?.message?.content?.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '').trim() || null;
};
