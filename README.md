# MAISON MIRO — Art Studio & Storefront

A React and Vite storefront for original paintings, studio pottery, and wall mural services. The project includes an Express API backed by PostgreSQL and customer/studio authentication.

## Requirements

- Node.js 20.19+ or 22.12+ and npm (required by the installed Vite 8 toolchain)
- Access to a PostgreSQL database configured for this application; Supabase PostgreSQL is supported
- The database connection URL and a private JWT signing secret

## Install on a clean machine

From the project root:

    npm ci
    npm --prefix server ci
    cp server/.env.example server/.env

Edit `server/.env` privately and set `DATABASE_URL` and `JWT_SECRET` using your intended database project and a strong private random value. Never paste these values into source files, screenshots, issue reports, or Git. The backend loads `server/.env` when started from the `server` directory. The committed `server/.env.example` contains placeholders only.

The frontend currently has no environment variables. Its API base URL is fixed in `src/api.js` as `http://localhost:3000`.

## Database setup and migrations

This repository does not contain a baseline schema creation or database seeding command. Use an existing PostgreSQL/Supabase project whose base schema contains the tables used by the backend, including `users`, `paintings`, `orders`, `wall_bookings`, `studio_settings`, `pottery_items`, `pottery_requests`, and `glazes`. `seedData/seed.json` documents sample catalogue data; it is not a database seeding script. A new empty database cannot be provisioned from this repository alone.

The checkout and approval workflows also require the two checked-in migrations. Before applying them, confirm that the database is the intended project, take a recoverable backup, and check whether they have already been applied. If they are missing, select the intended project in the Supabase Dashboard, open **SQL Editor**, create a query, paste the contents of `server/migrations/001_unified_checkout.sql`, and run it. After it succeeds, create a second query with `server/migrations/002_request_approvals.sql` and run that. Migration 001 adds checkout columns and `order_items`; migration 002 adds painting request/order links and the active mural-date index. Migration 002 drops and recreates that index, so existing requested/confirmed mural dates must not contain duplicates. Its painting-request unique indexes also require no duplicate active customer/artwork requests or duplicate approved requests for a painting. Do not run either migration against an unreviewed database, and do not rerun them blindly. This repository cannot verify the current live schema or migration state.

Painting requests and approvals, mural bookings, pottery requests, and checkout orders are implemented as PostgreSQL-backed workflows in the backend. Checkout stores one order with its items in PostgreSQL and the Studio orders view fetches those server orders. Older browser-local orders may still appear in the customer's history, but are not shared with the Studio. Direct painting purchases are disabled; customers request artwork, then add an approved request to the bag.

## Start the backend and frontend

In one terminal, from the project root:

    cd server
    npm run dev

The Express API listens at `http://localhost:3000`. Keep this terminal running.

In a second terminal, from the project root:

    npm run dev

Vite prints the frontend URL, normally `http://localhost:5173`. Open that URL in a browser; the app expects the backend to be running at localhost:3000. The site is configured for local development and is not deployed publicly by these instructions.

## Studio account setup

There is no public studio registration flow. The private setup script prompts for an email and password and creates a studio-role account in the configured database:

    cd server
    node create-studio-account.js

Only run this when a studio account is needed and after confirming the configured database is the intended target. This script writes to the database. It is not required for customer registration or frontend build verification. Customer sign-in is at `/login`; Studio sign-in is at `/admin-login`, and authorized Studio users can open `/studio` and the Artwork Catalogue link in the top navigation.

## Project checks

    npm run build
    npm run lint

There are no checked-in automated test files or working test suite command. The backend package's test script is a placeholder that exits with an error. No live database test is implied by a successful frontend build.

## Project structure

- src: React app, API client, authentication, cart, and local checkout history
- server: Express API, database-backed workflows, account setup script, and SQL migrations
- seedData/seed.json: reference artwork and service catalogue data; it is not a database seeding script
- public/images: artwork images
- README.md and DESIGN.md: setup and implementation notes

## Security notes

- Public registration creates customer accounts only.
- Studio accounts are created through the private script, never through public registration.
- Environment files are ignored by Git; only placeholder examples should be committed.
- Do not commit credentials, database connection strings, JWTs, or real account passwords.
- The seed JSON contains catalogue data only. Studio login credentials must be entered privately through the setup script.
