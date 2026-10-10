/**
 * What a /start payload means. Pure, so it can be tested without Telegram.
 *
 * The customer flow is everything that is not a link: a QR code opens
 * https://t.me/<bot>?start=<token>, where the token is 64 hex characters, so it can never start
 * with "link_". The dashboard's "connect Telegram" button opens ?start=link_<code>.
 */
export const LINK_PAYLOAD_PREFIX = 'link_';
/** The codes the API hands out: lowercase letters and digits. */
const LINK_CODE = /^[a-z0-9]{16,40}$/;

export type StartRoute =
  | { kind: 'none' } // plain /start, no payload
  | { kind: 'qr'; token: string } // the customer flow, exactly as before
  | { kind: 'link'; code: string | null }; // account linking; null = "link_" followed by something that is no code

export function routeStartPayload(payload: string | undefined | null): StartRoute {
  if (!payload) {
    return { kind: 'none' };
  }
  if (payload.startsWith(LINK_PAYLOAD_PREFIX)) {
    const code = payload.slice(LINK_PAYLOAD_PREFIX.length);
    return { kind: 'link', code: LINK_CODE.test(code) ? code : null };
  }
  return { kind: 'qr', token: payload };
}

export const LINK_REPLIES = {
  /** The code is unknown, used or too old, or the link was cut off. */
  INVALID:
    "Bu havola eskirgan yoki allaqachon ishlatilgan. Feekr profilingizdan yangi havola oling va qayta urinib ko'ring.",
  /** The API could not be reached or answered something unexpected. */
  FAILED:
    "Hozircha ulab bo'lmadi. Birozdan so'ng Feekr profilingizdan yangi havola olib, qayta urinib ko'ring.",
  /** Alerts go to a person, not to a group. */
  PRIVATE_ONLY: "Hisobni ulash uchun botga shaxsiy chatda yozing.",
};

export function linkSuccessReply(businessName: string | null | undefined): string {
  const name = businessName?.trim();
  return name
    ? `✅ Ulandi! Endi «${name}» bo'yicha past baholar haqidagi xabarlar shu yerga keladi.`
    : "✅ Ulandi! Endi past baholar haqidagi xabarlar shu yerga keladi.";
}

/** The reply for a failed link call, from the HTTP status of the API (undefined = no answer at all). */
export function linkFailureReply(status: number | undefined): string {
  return status === 404 || status === 410 || status === 400 ? LINK_REPLIES.INVALID : LINK_REPLIES.FAILED;
}
