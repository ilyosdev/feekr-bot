# Telegram Bot

Telegram bot that submits feedback into the API.

## Setup

```bash
npm install
cp .env.example .env
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
npm run start
```

## Environment

- `TELEGRAM_BOT_TOKEN`: Telegram bot token from BotFather
- `API_BASE_URL`: Base URL for the deployed API, including `/api`
- `BOT_API_KEY`: secret shared with the API (`BOT_API_KEY` there too), sent as `X-Bot-Key` when an
  owner or branch manager links their Telegram account (`/start link_<code>`). Optional: without it
  only account linking is unavailable.

## Tests

```bash
npm test
```

Runs the unit tests of the `/start` routing (`src/start-route.ts`) with Node's own test runner.
