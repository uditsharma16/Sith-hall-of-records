# Sith Hall of Records — Holocron Network

The Sith Order's Holocron Network, read live from a Trello board and served as a
Cloudflare Worker with static assets. The board is the source of truth: lists become
vaults, cards become holocron records, and edits on Trello appear on the site within about a minute.

Source board: https://trello.com/b/GtiwT003/tso-holocron-network

## Local development

```bash
npm install
npm run dev
```

To develop against a saved copy of the board (for example when Trello is unreachable),
point the Worker at any URL that serves the board's JSON export:

```bash
npx wrangler dev --var TRELLO_EXPORT_URL:http://127.0.0.1:8899/board.json
```

## Deployment

```bash
npm run deploy
```

Pushes to `main` deploy automatically through `.github/workflows/deploy.yml`, which needs the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

The Worker serves the frontend, retrieves the Trello board export, and proxies image
attachments so they can be embedded in record pages without a Trello login.
