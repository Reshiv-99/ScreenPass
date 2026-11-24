# ScreenPass progress

Estimated completion: **90% of the requested demo scope**. The remaining work is chiefly verification against external services and a device-reachable deployment.

## Implemented

- [x] Inspected the empty workspace and initialized React, Vite, Tailwind, Express, TypeScript, and Prisma.
- [x] Built all 16 requested pages, plus public ticket verification, shared navigation, dialogs, toasts, loading states, and responsive layouts.
- [x] Created a MySQL schema, initial migration, and development seed for 13 cities, an optional admin, six sample films, demo venues, showtimes, and two seat categories.
- [x] Added server-side TMDB catalogue, search, credits, videos, genres, India lists, caching, and a labeled sample fallback.
- [x] Added city selection, browser geolocation, Leaflet maps, and OpenStreetMap discovery via Overpass.
- [x] Built demo checkout, availability validation, atomic seat allocation, idempotent booking references, QR tickets, booking history, and cancellation with seat restoration.
- [x] Added bcrypt password hashing, HTTP-only sessions, role checks, protected admin routes, origin checks, and rate limiting.
- [x] Built admin dashboards and management for venues, screens, seat configuration, TMDB movie links, and demo shows/pricing.
- [x] Added unique movie release reminders and in-app release status.
- [x] Documented local setup, environment variables, database instructions, and the future Razorpay integration point.

## Verified

- [x] Applied the initial migration to isolated MySQL 9.6 on port 3307 and seeded the development data.
- [x] Started Express on port 4000 and Vite on port 5173. Confirmed the API health route through Vite.
- [x] Built the TypeScript and Vite production bundle.
- [x] Passed all 9 Vitest tests, including React Testing Library and Supertest. Verified admin inventory, provider adapters with mocked upstreams, ownership checks, ticket status, idempotency, and concurrent booking against MySQL.
- [x] Passed all 3 Playwright tests in Chrome. Verified checkout with a consistent booking reference, the QR ticket, cancellation, mobile city selection and search, admin inventory access, and the 404 page.
- [x] Inspected desktop and mobile rendering. Confirmed all six fallback posters loaded.
- [x] Confirmed the Leaflet view renders and shows a recoverable message when Overpass is unavailable.

## Pending verification

- [ ] Exercise authenticated live TMDB calls, current upcoming titles, and live release details after adding a TMDB API Read Access Token.
- [ ] Verify QR scanning from a second device after configuring a reachable HTTPS `APP_ORIGIN`.
- [x] Removed public OpenStreetMap discovery after the venue lookup returned HTTP 503. The old Cinemas URL now redirects to Movies. City selection still filters demo showtimes, and the admin dashboard still manages cinemas.

Live payment is outside this build. The original MySQL service on port 3306 was left untouched.

## Movie detail resilience

- [x] Retry transient TMDB movie detail failures once. Respect upstream rate limits and distinguish confirmed missing titles from a temporary service outage.
- [x] Use the cached TMDB catalogue summary when full details are unavailable, so previously browsed movies still open.
- [x] Verified live details for the title reported by the user, OM: Chapter 1, and added regression tests for retries, fallback, and confirmed missing titles.

## Automatic city selection

- [x] Resolve the device's approximate coordinates to a city from the browser, including cities outside the preset list.
- [x] Save the city across reloads and provide manual selection from the GeoNames Indian city directory when location permission or lookup is unavailable.
- [x] Keep showtimes filtered to the selected city and show an empty state when it has no configured demo shows.
- [x] Suggest Indian cities from the first typed letter, show states for duplicate names, and save only a selected suggestion or preset.

## New-release catalogue and demo timing previews

- [x] Limit the public catalogue and search to recent and upcoming releases. Exclude old sample films while preserving managed inventory and booking history.
- [x] Use the India theatrical release date for demo timing previews. Generate a rolling four-day schedule in any selected city when there are no managed shows.
- [x] Show release-day messaging for upcoming films. Preview timings are display-only pending the seat and ticket phase.
- [x] Verified both live TMDB release lists and exclusion of The Dark Knight. Production build, 15 Vitest tests, and 5 Playwright tests passed.

## Demo seat maps

- [x] Connect generated timings to reusable MySQL seat inventory in supported Indian cities, including Fatehabad.
- [x] Redesign the seat picker with a show card, booking steps, auditorium availability, price legend, and responsive order summary.
- [x] Verify concurrent setup shares one show. Check the live Fatehabad seat picker in desktop and mobile Chrome and verify a standard and premium selection totals ₹700.

## Catalogue and seat availability regression checks

- [x] Reproduced a live catalogue page failure. TMDB reads now retry temporary errors with a bounded delay and share duplicate in-flight requests.
- [x] Keep the most recent successful catalogue page visible while the next one loads or fails.
- [x] Applied the MySQL migration for the original disabled edge-seat patterns on demo screens. Fresh demo layouts start with all seats enabled. Existing reservations and other configured disabled layouts remain covered by the booking rules.
- [x] Live Chrome verified Movies pages 1–4 and selected A1 and A10 on the reported Fatehabad show. Live Upcoming, Trending, and Popular API pagination returned TMDB results.
- [x] Production build, 17 Vitest tests, and 7 Playwright tests passed. Coverage includes account access, profile updates, release dates, city selection, trailers opening, demo shows, checkout, ticket verification, cancellation, and admin inventory.

## Cinema owner and staff access

- [x] Add an owner role and a one-time owner setup command for dedicated installations.
- [x] Allow the owner to find signed-up staff by email, grant admin access, and revoke access from the Users tab.
- [x] Enforce role changes on the server, protect the owner account, and apply staff access changes to existing sessions on the next protected request.

## Evaluation readiness check

- [x] Fix a search debounce that could reset catalogue pagination on first load. Verify live pages 1–3.
- [x] Update older browser tests to distinguish password inputs from the visibility toggle.
- [x] Complete a live TMDB movie journey in Fatehabad through signup, seat booking, QR verification, cancellation, and seat release.
- [x] Production build, 18 Vitest tests, and 9 Playwright tests passed.

## Razorpay Test Mode

- [x] Apply the MySQL migration for payment attempts and expiring seat holds.
- [x] Add Razorpay order creation, hosted checkout, server-side capture verification, signed webhook handling, and an admin payment history.
- [x] Verify with simulated provider responses that competing checkouts cannot hold the same seat, an authorized payment does not issue a ticket, a captured payment issues one ticket, and a late capture goes to review.
- [x] Production build, 19 automated tests, and 10 Chrome tests passed.
- [x] Verified the configured Test Mode keys with a ₹280 Razorpay mock-bank payment in Chrome. ScreenPass verified capture and issued the QR ticket.

## Booking email and credits

- [x] Move the movie-data attribution to Credits and use neutral payment wording on ScreenPass's booking pages.
- [x] Apply the booking-email queue migration and generate PDF tickets with a verification QR.
- [x] Render and inspect a sample PDF ticket.
- [x] Pass the production build, 20 Vitest tests, and 3 targeted Chrome tests covering checkout, footer navigation, and Credits.
- [ ] Verify real inbox delivery after configuring a sending account and verified sender.
- [x] Pause email delivery locally and hide confirmation email status until the sending setup is ready.

## Seat selection layout

- [x] Give the auditorium the full content width, label each price section, and place the screen and order summary below the rows.
- [x] Verify the production build, mobile touch selection, and the Chrome test checkout.

## Demo seat tiers

- [x] Configure Classic rows A–D at ₹350, Prime rows E–G at ₹550, and Recliner row H at ₹750 for demo inventory.
- [x] Apply the local MySQL migration and verify all tier prices with API tests and a mixed-tier Chrome test checkout.

## ScreenPass rebrand

- [x] Update the app, demo venues, tickets, checkout, and setup documentation to ScreenPass.
- [x] Apply the local migration and verify new and existing ticket references. Production build, 20 automated tests, and three Chrome checks passed.

## Deployment preparation

- [x] Configure Vercel to serve the React build and run the Express API under the same origin.
- [x] Verify the Vite build, Express function entry point, and 20 automated tests locally.
- [ ] Provision hosted MySQL, deploy from GitHub, and verify the public booking flow.

## Snacks and drinks

- [x] Add an optional menu with three illustrated concessions and quantity controls between seats and booking review.
- [x] Validate quantities and calculate totals on the server for demo and test payments. Save purchased items for booking history and tickets.
- [x] Apply local MySQL migration and verify the production build, all 20 automated tests, mobile demo checkout, and simulated test payment checkout.

- [x] Replace the initial menu with Food, Drinks, and Combos tabs, independently priced sizes, and a shared cart. Verify a mixed order across all three tabs in Chrome.

## End-to-end regression check

- [x] Verify the production build, all 20 automated tests, and all 12 Chrome tests. Run the demo booking against a demo-mode API and simulate Razorpay in its separate browser test.
