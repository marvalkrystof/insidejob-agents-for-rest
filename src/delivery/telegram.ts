import { z } from "zod";
import { fetchJson } from "../libs/http.utils";

const sendMessageResponseSchema = z.object({ ok: z.literal(true) });

export const sendTelegramMessage = async (botToken: string, chatId: string, html: string): Promise<void> => {
  const response = await fetchJson(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
  });
  sendMessageResponseSchema.parse(response);
};
