# ScreenPass

ScreenPass is a local movie-ticket booking demo built with React, Vite, Tailwind, Express, Prisma, and MySQL. All bookable schedules are managed by ScreenPass administrators. Customers start from a movie and use their selected city to see available demo showtimes. Demo bookings reserve seats and issue verifiable QR tickets without collecting payment.

## 📸 Screenshots

### Home page
<img width="1896" height="917" alt="image" src="https://github.com/user-attachments/assets/681fc4a5-d6a2-4143-95b2-42654edc11e9" />


### Booking
<img width="1348" height="648" alt="image" src="https://github.com/user-attachments/assets/f14166ec-5095-4ef7-942a-6810ea3c6e3a" />


## Deploy for evaluation

Follow the [GitHub and Vercel deployment guide](DEPLOYMENT.md) to publish ScreenPass with one public HTTPS URL and a hosted MySQL database.

## Start the application

Use Node.js 22 or newer, npm, and a MySQL instance with an empty ScreenPass database. The initial migration uses InnoDB and was tested on MySQL 9.6. MySQL 8.0+ supports the locking syntax used by the booking service.

```sh
npm ci
cp -n .env.example .env
```

Set `DATABASE_URL` in `.env`. For a fresh instance, connect as a MySQL administrator and run the following with a strong local password. URL-encode special characters when putting the password into `DATABASE_URL`.

```sql
CREATE DATABASE screenpass CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'screenpass'@'127.0.0.1' IDENTIFIED BY '<strong-local-password>';
GRANT ALL PRIVILEGES ON screenpass.* TO 'screenpass'@'127.0.0.1';
```

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` together to seed an administrator. Use a password of at least 12 characters and no more than 72 UTF-8 bytes. Omit both to skip admin seeding. Running the seed again preserves existing accounts and showtimes and creates future demo inventory where schedules permit.

```sh
npm run db:generate
npm run db:migrate
npm run db:seed
```

In one terminal run `npm run dev:api`. In another run `npm run dev`. Open [the frontend](http://localhost:5173/) or check [API health](http://localhost:4000/api/health). Admins can open [the dashboard](http://localhost:5173/admin) after signing in.

### Database on the original development machine

The workspace already has a generated `.env` and an isolated MySQL data directory under `.local/dev-mysql`. It uses loopback port 3307. The pre-existing MySQL service on port 3306 is separate. Keep the existing `DATABASE_URL` when upgrading an installation so it continues using the same database. Read the generated admin email and password from your local `.env` to sign in. If port 3307 has no ScreenPass MySQL server listening, start it from the project directory in its own terminal.

```sh
npm run db:start
```

### Environment

- `DATABASE_URL` connects Prisma to MySQL.
- `TMDB_ACCESS_TOKEN` is the TMDB API Read Access Token. Put it in the backend environment and restart the API. The customer catalogue shows recent and upcoming releases. When TMDB is unavailable and there is no cached data, the catalogue displays an availability message.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` configure the optional development admin used during seeding.
- `APP_ORIGIN` defaults to `http://localhost:5173`. It controls write-origin checks, session cookie security, and the public base URL embedded in QR codes. Use a device-reachable HTTPS origin for scanning from a second device.
- `PORT` defaults to 4000. `HOST` defaults to `127.0.0.1`.
- `OVERPASS_URL` optionally changes the Overpass endpoint. The default is `https://overpass-api.de/api/interpreter`. The server caches successful discovery results. The discovery API is retained for development. The public site does not use it.
- The browser uses BigDataCloud to resolve an approximate location to a city after the user grants location permission. ScreenPass saves the selected city in the browser. Users can also search for an Indian city and select a verified place from the bundled list. For a film released theatrically in India, ScreenPass displays managed demo shows and fills open demo times for the selected city.

See the [TMDB API documentation](https://developer.themoviedb.org/docs/getting-started), [TMDB regional behavior](https://developer.themoviedb.org/docs/region-support), and [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## Booking behavior

A booking stores the film, venue, time, and seat pricing as snapshots. The API computes pricing and reserves all selected seats in one MySQL transaction. Conditional updates on uniquely keyed show-seat rows prevent duplicate allocation. A confirmed booking can be cancelled more than 30 minutes before the show. Cancellation releases its seats and changes the QR verification result.

The QR contains an opaque ticket token inside a verification URL. The public verification endpoint returns the reference and status. Ticket details are available to the account that made the booking.

The booking service owns allocation and pricing. A future Razorpay integration can use those server-side values and confirm a booking from an authenticated payment event. A live payment flow will also need expiring seat holds, webhook idempotency, and a payment state model.

## Verification

Run the tests on a seeded development database with the owner set up using the same configured credentials. The tests create their own accounts and bookings. Browser tests use catalogue fixtures for release and city-selection checks and seeded managed shows for checkout.

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

If Google Chrome is installed, run `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` with the API and frontend already running. Integration tests exercise validation, session cookies, role checks, notification deduplication, concurrent booking, cancellation and verification against MySQL.

The complete Chrome suite requires the backend in demo mode with both Razorpay keys empty. To leave an existing Razorpay Test Mode server running, start a second API and frontend in separate terminals:

```sh
PORT=4015 APP_ORIGIN=http://localhost:5185 RAZORPAY_KEY_ID= RAZORPAY_KEY_SECRET= npm run start:api
PORT=4015 npm run dev -- --port 5185
PLAYWRIGHT_BASE_URL=http://localhost:5185 PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```


## Artwork

Sample posters and backdrops are from TMDB, with a [Dune: Part Two film still](https://www.gq.com/story/weird-dune-sequels) and the [Oppenheimer theatrical poster](https://www.impawards.com/2023/oppenheimer.html) bundled for the fallback catalogue. This product uses the TMDB API but is not endorsed or certified by TMDB.

## City suggestions

City suggestions use the Indian populated places from the [GeoNames cities500 extract](https://download.geonames.org/export/dump/cities500.zip), joined to [GeoNames administrative areas](https://download.geonames.org/export/dump/admin1CodesASCII.txt). ScreenPass keeps the GeoNames ID, ASCII place name, and state, and orders places by population. Data by [GeoNames](https://www.geonames.org/export/) under the [Creative Commons Attribution 4.0 license](https://creativecommons.org/licenses/by/4.0/).

## Current releases and preview showtimes

The public catalogue uses a rolling 90-day recent-release window and lists upcoming India theatrical releases for the next 90 days. Older titles are excluded from public search and movie pages. Historical bookings and admin inventory remain accessible through their own routes.

For an eligible film without managed demo shows in the selected city, ScreenPass displays a rolling four-day preview schedule in IST. The timings appear when the India theatrical release date arrives. Selecting a generated time in a listed Indian city creates its simulated auditorium and 80-seat inventory in MySQL. Subsequent visits share the same seats and the existing demo checkout.


## Hand off a dedicated installation to a cinema

Use a separate application deployment and MySQL database for each cinema business. On the new installation set `DATABASE_URL` and `APP_ORIGIN`, and configure `ADMIN_EMAIL` and `ADMIN_PASSWORD` with that business owner's email and a unique password. After installing dependencies, run:

```sh
npm run db:generate
npm run db:migrate
npm run db:setup-owner
```

The owner setup is a one-time operator command. On an existing installation it can elevate the configured admin if the current password is supplied and there is no owner yet. Run the demo seed separately when you want demo inventory. Share the initial owner credentials privately.

Staff sign up with their own accounts. The owner signs in at `/admin`, opens **Users**, searches by the staff email, confirms the staff member controls that account, and chooses **Grant admin access**. **Revoke admin access** returns the account to customer permissions while retaining its personal bookings. An admin can operate cinema inventory and view users and bookings. The owner alone can change staff access. Role changes apply to subsequent protected API requests, including existing sessions.

## Razorpay Test Mode

Use Razorpay's test environment for evaluations. Generate the **Test Mode Key ID** and **Key Secret** in the Razorpay Dashboard and add them to the local backend `.env` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. The ID must start with `rzp_test_`. Keep the secret local and restart the API. Both values are required to enable payment. Leaving both blank keeps demo checkout available.

At booking review, click **Pay · Test mode** to open the Razorpay-hosted checkout. ScreenPass reserves the selected seats for up to 10 minutes, creates an INR order using server prices, and issues a ticket only after verifying the payment signature and captured status. Failed or abandoned payment attempts release their seats at expiry. Reopen checkout or use **Check payment status** to recover a captured test payment. Captures arriving after a seat hold expires are marked **Review needed** under **Admin → Payments** and do not issue a ticket.

The direct payment verification path works on localhost. For asynchronous capture events, set a separate `RAZORPAY_WEBHOOK_SECRET` and configure a publicly reachable HTTPS `/api/payments/webhook` for `payment.captured` in the Test Mode dashboard. The webhook verifies the raw-body signature and is safe to redeliver. See [Razorpay Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/) and [webhook setup](https://razorpay.com/docs/webhooks/validate-test/).

No real money moves in this integration. Cancelling a test-paid ScreenPass booking cancels the ticket and restores the seat. It does not issue a gateway refund.

## Booking confirmation emails

To email the signed-in customer's PDF ticket after booking confirmation, set `RESEND_API_KEY` and `BOOKING_EMAIL_FROM` in the backend `.env`. For delivery to arbitrary customer addresses, verify a sending domain in Resend and use a sender on that domain, such as `ScreenPass <tickets@yourdomain.com>`. Then run `npm run db:migrate` and restart the API. The API processes newly confirmed bookings automatically and retries temporary email failures. With the variables unset, tickets remain available in **My bookings**.

Set `APP_ORIGIN` to the deployed HTTPS origin so the QR in an emailed PDF can be opened from another device. A QR generated against localhost can be verified only from the machine running ScreenPass.
