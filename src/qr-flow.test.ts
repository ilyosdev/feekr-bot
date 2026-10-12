import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

/**
 * The customer flow of a QR scan, run through the bot's real handlers.
 *
 * Nothing leaves this process: every call the bot makes to Telegram is answered by a transformer
 * that only records it, and the Feekr API is a local server that answers like the real one. The
 * token is made up, and the bot is never started (no polling).
 */

const STAFF_QR = 'ab'.repeat(32); // a code printed for one staff member
const LOCATION_QR = 'cd'.repeat(32); // a code printed for a branch
const LOCATION = { id: 1, name: 'Chilonzor filiali' };
const AZIZ = { id: 7, name: 'Aziz Karimov', position: 'Ofitsiant' };
const DILNOZA = { id: 8, name: 'Dilnoza Rahimova', position: 'Kassir' };

const FIRST_QUESTION = /^O'zingiz xohlagan narsani topdingizmi\?/;
const FIRST_QUESTION_BUTTONS = ['found_yes', 'found_no', 'cancel_feedback'];

/* ------------------------------ the Feekr API, as the bot sees it ------------------------------ */

const knownCustomers = new Set<string>(); // Telegram chat ids the API has a customer for
const feedbacks: Record<string, unknown>[] = [];

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

async function feekrApi(req: http.IncomingMessage, res: http.ServerResponse) {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const url = req.url ?? '';
  const route = `${req.method} ${url}`;

  if (route === `GET /api/qrcodes/validate/${STAFF_QR}`) {
    return send(200, {
      isValid: true,
      qrCode: { id: 2, locationId: LOCATION.id, staffId: AZIZ.id, type: 'staff', location: LOCATION, staff: AZIZ },
    });
  }
  if (route === `GET /api/qrcodes/validate/${LOCATION_QR}`) {
    return send(200, { isValid: true, qrCode: { id: 1, locationId: LOCATION.id, type: 'location', location: LOCATION } });
  }
  if (url.startsWith('/api/qrcodes/validate/')) {
    return send(200, { isValid: false });
  }
  if (route === `GET /api/qrcodes/location/${LOCATION.id}/staff`) {
    return send(200, [
      { ...AZIZ, locationId: LOCATION.id },
      { ...DILNOZA, locationId: LOCATION.id },
    ]);
  }
  if (req.method === 'GET' && url.startsWith('/api/customers/check-user/')) {
    const chatId = url.split('/').pop() ?? '';
    return send(200, knownCustomers.has(chatId) ? { id: 1, telegramChatId: chatId } : null);
  }
  if (route === 'POST /api/customers/find-or-create') {
    const body = await readBody(req);
    knownCustomers.add(String(body.telegramChatId));
    return send(201, { id: 1, ...body });
  }
  if (route === 'POST /api/feedbacks') {
    feedbacks.push(await readBody(req));
    return send(201, { id: feedbacks.length });
  }
  return send(404, { message: `not part of this test: ${route}` });
}

/* ------------------------------ Telegram, as the bot sees it ------------------------------ */

interface Sent {
  text: string;
  buttons: string[]; // callback data of the inline buttons, in order
  asksContact: boolean;
}

const sent: Sent[] = [];
const onScreen = new Map<number, Set<string>>(); // per chat: the inline buttons the bot has sent since the scan
let server: http.Server;
let bot: typeof import('./index').bot;
let updateId = 0;
const log = console.log;
const logError = console.error;

before(async () => {
  server = http.createServer((req, res) => void feekrApi(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  // Set before the bot is loaded: it reads both when its module runs.
  process.env.TELEGRAM_BOT_TOKEN = '1:not-a-real-token';
  process.env.API_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  console.log = () => {}; // the handlers log every step
  console.error = () => {};

  ({ bot } = require('./index') as typeof import('./index'));
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Feekr',
    username: 'feekr_test_bot',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  } as typeof bot.botInfo;
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === 'sendMessage') {
      const message = payload as { chat_id: number; text: string; reply_markup?: any };
      const buttons: string[] = (message.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => b.callback_data);
      sent.push({
        text: message.text,
        buttons,
        asksContact: !!message.reply_markup?.keyboard?.[0]?.[0]?.request_contact,
      });
      const shown = onScreen.get(message.chat_id) ?? new Set<string>();
      buttons.forEach((button) => shown.add(button));
      onScreen.set(message.chat_id, shown);
      return { ok: true, result: { message_id: sent.length, date: 0, chat: { id: message.chat_id, type: 'private' }, text: message.text } } as any;
    }
    return { ok: true, result: true } as any;
  });
});

after(async () => {
  console.log = log;
  console.error = logError;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const person = (id: number) => ({ id, is_bot: false, first_name: 'Sinov' });
const chat = (id: number) => ({ id, type: 'private', first_name: 'Sinov' });

/** Hands one update to the bot and returns what it sent in answer. */
async function deliver(update: Record<string, unknown>): Promise<Sent[]> {
  const from = sent.length;
  await bot.handleUpdate({ update_id: (updateId += 1), ...update } as any);
  return sent.slice(from);
}

const says = (id: number, text: string) => {
  if (text.startsWith('/start')) onScreen.delete(id); // a new scan: what was offered before no longer counts
  return deliver({
    message: {
      message_id: updateId + 1,
      date: 0,
      chat: chat(id),
      from: person(id),
      text,
      ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}),
    },
  });
};

const sharesPhone = (id: number) =>
  deliver({
    message: {
      message_id: updateId + 1,
      date: 0,
      chat: chat(id),
      from: person(id),
      contact: { phone_number: '+998901234567', first_name: 'Sinov', user_id: id },
    },
  });

/** A customer can only press a button the bot has put on the screen (an inline button stays under its message). */
const presses = (id: number, data: string) => {
  assert.ok(onScreen.get(id)?.has(data), `"${data}" was never offered to chat ${id}: ${[...(onScreen.get(id) ?? [])].join(', ') || 'no buttons at all'}`);
  return deliver({
    callback_query: {
      id: String(updateId + 1),
      from: person(id),
      chat_instance: 'test',
      data,
      message: { message_id: 1, date: 0, chat: chat(id), from: { id: 1, is_bot: true, first_name: 'Feekr' }, text: '…' },
    },
  });
};

/* ------------------------------ the flows ------------------------------ */

test('a staff QR: the first question follows the welcome', async () => {
  knownCustomers.add('501');

  const replies = await says(501, `/start ${STAFF_QR}`);

  assert.equal(replies.length, 2, replies.map((r) => r.text).join(' | '));
  assert.match(replies[0].text, /"Aziz Karimov" \(Ofitsiant\) xodimimizga baho berasiz/);
  assert.match(replies[1].text, FIRST_QUESTION);
  assert.deepEqual(replies[1].buttons, FIRST_QUESTION_BUTTONS);
});

test('a staff QR: the flow goes to the end, and the feedback names the staff member of the code', async () => {
  knownCustomers.add('502');
  await says(502, `/start ${STAFF_QR}`);

  assert.match((await presses(502, 'found_yes'))[0].text, /^Kerakli ma'lumotni oldingizmi\?/);
  assert.match((await presses(502, 'info_no'))[0].text, /^Xizmat sifatiga qanday baho berasiz\?/);
  assert.deepEqual((await presses(502, 'rating_9'))[0].buttons, ['skip_feedback', 'cancel_feedback']);
  const end = await presses(502, 'skip_feedback');

  assert.equal(end[0].text, 'Rahmat! Fikr-mulohazangiz biz uchun muhim.');
  assert.deepEqual(feedbacks.at(-1), {
    locationId: LOCATION.id,
    staffId: AZIZ.id,
    qrCodeToken: STAFF_QR,
    foundWhatWanted: true,
    gotEnoughInfo: false,
    staffRating: 9,
    telegramChatId: '502',
  });
});

test('a staff QR: a new customer shares the phone number and then gets the first question', async () => {
  const asked = await says(503, `/start ${STAFF_QR}`);
  assert.equal(asked.length, 1);
  assert.ok(asked[0].asksContact, 'the bot asks for the phone number first');

  const replies = await sharesPhone(503);

  const last = replies.at(-1)!;
  assert.match(last.text, FIRST_QUESTION);
  assert.deepEqual(last.buttons, FIRST_QUESTION_BUTTONS);
  assert.ok(replies.some((r) => /"Aziz Karimov"/.test(r.text)), 'the welcome names the staff member');
});

test('a staff QR scanned in the middle of another feedback starts over with its first question', async () => {
  knownCustomers.add('504');
  await says(504, `/start ${LOCATION_QR}`);

  const replies = await says(504, `/start ${STAFF_QR}`);

  assert.match(replies[0].text, /Yangi QR kod skanerlandi/);
  assert.match(replies.at(-1)!.text, FIRST_QUESTION);
  assert.deepEqual(replies.at(-1)!.buttons, FIRST_QUESTION_BUTTONS);
});

test('a location QR is as it was: the staff list first, the question after the choice', async () => {
  knownCustomers.add('505');

  const replies = await says(505, `/start ${LOCATION_QR}`);

  assert.equal(replies.length, 2, replies.map((r) => r.text).join(' | '));
  assert.match(replies[0].text, /"Chilonzor filiali" filialimizga baho berasiz/);
  assert.match(replies[1].text, /^Sizga kim xizmat ko'rsatdi\?/);
  assert.deepEqual(replies[1].buttons, [`staff_${AZIZ.id}`, `staff_${DILNOZA.id}`, 'staff_none', 'cancel_feedback']);

  const next = await presses(505, `staff_${DILNOZA.id}`);
  assert.equal(next.length, 1);
  assert.match(next[0].text, FIRST_QUESTION);

  await presses(505, 'found_no');
  await presses(505, 'info_yes');
  await presses(505, 'rating_4');
  await says(505, 'Navbat uzun edi');
  assert.deepEqual(feedbacks.at(-1), {
    locationId: LOCATION.id,
    staffId: DILNOZA.id,
    qrCodeToken: LOCATION_QR,
    foundWhatWanted: false,
    gotEnoughInfo: true,
    staffRating: 4,
    telegramChatId: '505',
    additionalComments: 'Navbat uzun edi',
  });
});

/* ------------------------------ answers typed instead of pressed ------------------------------ */

test('typed answers count like the buttons: "Ha", "Yo\'q", "9", then a comment', async () => {
  knownCustomers.add('506');
  await says(506, `/start ${STAFF_QR}`);

  const afterHa = await says(506, 'Ha');
  assert.equal(afterHa.length, 1);
  assert.match(afterHa[0].text, /^Kerakli ma'lumotni oldingizmi\?/);
  assert.match((await says(506, "Yo'q"))[0].text, /^Xizmat sifatiga qanday baho berasiz\?/);
  assert.deepEqual((await says(506, '9'))[0].buttons, ['skip_feedback', 'cancel_feedback']);
  const end = await says(506, 'Zoʻr xizmat');

  assert.equal(end[0].text, 'Rahmat! Fikr-mulohazangiz biz uchun muhim.');
  assert.deepEqual(feedbacks.at(-1), {
    locationId: LOCATION.id,
    staffId: AZIZ.id,
    qrCodeToken: STAFF_QR,
    foundWhatWanted: true,
    gotEnoughInfo: false,
    staffRating: 9,
    telegramChatId: '506',
    additionalComments: 'Zoʻr xizmat',
  });
});

test('a typed answer the bot cannot read gets the question again, and nothing is taken from it', async () => {
  knownCustomers.add('507');
  await says(507, `/start ${STAFF_QR}`);
  const before = feedbacks.length;

  const unclear = await says(507, 'balki');
  assert.equal(unclear.length, 2);
  assert.equal(unclear[0].text, 'Iltimos, "Ha" yoki "Yo\'q" javobini kiriting.');
  assert.match(unclear[1].text, FIRST_QUESTION);
  assert.deepEqual(unclear[1].buttons, FIRST_QUESTION_BUTTONS);

  await says(507, 'Ҳа'); // Cyrillic
  await presses(507, 'info_yes'); // a button still works after typing
  const tooHigh = await says(507, '11');
  assert.equal(tooHigh[0].text, "Iltimos, 1 dan 10 gacha bo'lgan raqam kiriting.");
  assert.match(tooHigh[1].text, /^Xizmat sifatiga qanday baho berasiz\?/);
  assert.ok(tooHigh[1].buttons.includes('rating_10'));

  await presses(507, 'rating_3');
  await presses(507, 'skip_feedback');
  assert.equal(feedbacks.length, before + 1);
  assert.deepEqual(feedbacks.at(-1), {
    locationId: LOCATION.id,
    staffId: AZIZ.id,
    qrCodeToken: STAFF_QR,
    foundWhatWanted: true,
    gotEnoughInfo: true,
    staffRating: 3,
    telegramChatId: '507',
  });
});

test('text typed while the staff list is on the screen is not an answer to the next question', async () => {
  knownCustomers.add('508');
  await says(508, `/start ${LOCATION_QR}`);

  const replies = await says(508, 'Ha');

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, "Iltimos, yuqoridagi ro'yxatdan tanlang.");
  // The list still works, and the first question comes only now.
  const next = await presses(508, 'staff_none');
  assert.match(next[0].text, FIRST_QUESTION);
  assert.match((await says(508, 'yoq'))[0].text, /^Kerakli ma'lumotni oldingizmi\?/);
});

test('a new customer who types before sharing the phone number is asked for it again', async () => {
  await says(509, `/start ${STAFF_QR}`);

  const replies = await says(509, 'Salom');

  assert.equal(replies.length, 1);
  assert.ok(replies[0].asksContact, 'the phone button is offered again');
  assert.match((await sharesPhone(509)).at(-1)!.text, FIRST_QUESTION);
});

test('text with no feedback in progress gets the hint to scan a code', async () => {
  const replies = await says(510, 'Salom');

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, "Iltimos, /start buyrug'ini QR kod parametri bilan ishlating.");
});

test('a code the API does not accept (unknown or switched off) is called invalid', async () => {
  knownCustomers.add('511');

  const replies = await says(511, `/start ${'ef'.repeat(32)}`);

  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, 'Bu QR kod yaroqsiz. Iltimos, toʻgʻri QR koddan foydalaning.');
});
