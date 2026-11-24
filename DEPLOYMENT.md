# Deploy ScreenPass with GitHub and Vercel

Vercel serves the Vite build and routes requests under `/api` to the Express function on the same domain. Create a hosted **MySQL** database that accepts connections from your Vercel functions. Choose a region near the functions and use the provider's TLS connection settings. Keep the database connection string in environment variables.

## 1. Initialize the hosted database

From the project folder, use a fresh hosted MySQL database and set its connection string for this Terminal session without storing it in shell history. On macOS with zsh, run the lines below, paste the connection string at the prompt, and press Enter.

```zsh
(
  read -rs "DATABASE_URL?Hosted MySQL connection string: "
  case "$DATABASE_URL" in
    mysql://?*) export DATABASE_URL ;;
    *) echo "Enter the hosted MySQL connection string."; exit 1 ;;
  esac
  npm run db:generate && npm run db:migrate && ADMIN_EMAIL= ADMIN_PASSWORD= npm run db:seed
)
```

The seed creates demo inventory. The empty admin values prevent the seed from using credentials from your local `.env`. To add a hosted owner later, run `npm run db:setup-owner` with the hosted `DATABASE_URL` and separate owner credentials in the environment. Existing local bookings stay in the local database.

## 2. Push to a private GitHub repository

Create an empty private repository named `screenpass` on GitHub. If this project folder is outside Git, run the commands below, replacing `YOUR-USERNAME`.

```sh
git init -b main
git add .
git diff --cached --name-only
git commit -m "Prepare ScreenPass for Vercel"
git remote add origin https://github.com/YOUR-USERNAME/screenpass.git
git push -u origin main
```

Check the staged list before committing. Include `.env.example` and the Prisma migrations. Keep `.env`, local database files, dependencies, and `.vercel` out of GitHub.

## 3. Import the repository in Vercel

1. In [Vercel](https://vercel.com/new), select **Add New → Project** and import the private GitHub repository. Use the repository root. The build command and output directory are already configured in `vercel.json`.
2. Add these variables to the **Production** environment before deploying:
   - `DATABASE_URL` with the hosted MySQL connection string.
   - `TMDB_ACCESS_TOKEN` with your TMDB API Read Access Token.
   - `APP_ORIGIN` with the public HTTPS origin, for example `https://your-screenpass.vercel.app`. After Vercel assigns your production URL, confirm the exact value and redeploy if you updated it.
3. Leave the Razorpay and Resend settings empty for the built-in demo checkout and on-site QR tickets. The Vercel function handles requests on demand. Ticket email delivery would need a separate scheduled worker before enabling it there.
4. Click **Deploy**. When it completes, open `/api/health` on the public domain. Then sign up, book a demo ticket, refresh **My Bookings**, and verify the QR from another device.

Future pushes to the production branch trigger deployments through GitHub. For database schema changes, apply the checked-in Prisma migrations to hosted MySQL as a separate step. Use a separate database and matching `APP_ORIGIN` for preview deployments that need working sign-in and booking.

See [Vercel Git deployments](https://vercel.com/docs/git), [environment variables](https://vercel.com/docs/environment-variables), and [project configuration](https://vercel.com/docs/project-configuration/vercel-json).
