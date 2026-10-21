# MAISON MIRO — Design and Assignment Notes

## Architecture

The customer and Studio interfaces use React 19 with Vite 8. The Express 5 backend uses PostgreSQL through `pg`; `src/api.js` currently targets `http://localhost:3000`. Artwork images use paths under `public/images` or an image URL. There is no upload service.

## Assignment question 1: How do login and the two roles work?

Customer registration calls the backend, which hashes the password with bcrypt and assigns the `customer` role; a submitted role is not trusted. Login returns a signed JWT, stored in browser `sessionStorage` and checked against `/api/auth/me`. Studio accounts are created through the private `server/create-studio-account.js` script, not public registration. Backend middleware protects Studio endpoints: missing/invalid tokens receive 401 and an authenticated user with the wrong role receives 403.

## Assignment question 2: Which database is used and why?

The backend uses PostgreSQL and accepts a Supabase PostgreSQL connection through `DATABASE_URL`. Relational tables, foreign keys, transactions, and row locks support shared accounts, artwork, requests, bookings, and orders. The repository does not create the base schema or seed the database; `seedData/seed.json` is reference data, not a seeding script. The live schema and migration state have not been verified by this repository check.

## Assignment question 3: How are duplicate paintings and mural dates prevented?

Artwork requests and purchases are checked on the server, with row locks around approval/checkout and a partial unique index preventing more than one approved request per painting when migration 002 is installed. Checkout validates availability and records the order and inventory change in a database transaction. Mural dates are checked against the 7–90 day policy, while a partial unique index limits active requested/confirmed bookings to one per date; migration 002 replaces that index. These database safeguards depend on compatible tables, successful migrations, and a reachable database, so their live enforcement must be verified before claiming production protection.

## Assignment question 4: What is complete, what is incomplete, and what comes next?

The code includes customer and Studio sign-in, role-protected request management, artwork creation/editing, customer painting requests and approval, mural bookings, pottery requests, and a mixed COD checkout with server-side price and availability checks. New checkout orders and their items are intended to persist in PostgreSQL and appear in Studio orders; older browser-local orders may remain in customer history but are not shared with Studio. The direct painting purchase route is disabled, so paintings use the request-and-approval flow.

The repository has no base-schema provisioning or database seed command, no image-upload service, and no automated test suite; the backend `npm test` script is a placeholder. The frontend API URL is fixed to localhost, and this review did not verify a live database connection, migration state, or end-to-end persistence. Next, verify the intended database and backup, confirm the existing tables and migrations, then run the workflows against a non-production test account/database before deployment. Configure a production API URL and hosting only when deployment is planned.

## Environment variables

The backend requires `DATABASE_URL` and `JWT_SECRET`, documented with placeholder values in `server/.env.example`. The frontend currently uses no Vite environment variables. Keep real values in the ignored `server/.env` file or a secret manager; never commit them.
