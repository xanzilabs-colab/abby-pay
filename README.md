# AbbyPay

AbbyPay is a WhatsApp-first escrow workflow with a protected operations dashboard.

## Local Development

Configure the values in `.env.local`, then run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000` to access the admin login.

## Deployment

Deploy the `main` branch to Vercel. Configure every `.env.local` value as a Vercel environment variable, set `NEXT_PUBLIC_APP_URL` to the deployment URL, and register `https://your-domain/api/webhooks/zernio` with Zernio for `message.received` events.
