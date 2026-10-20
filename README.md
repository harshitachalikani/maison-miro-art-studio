# MAISON MIRO — Art Studio & Storefront

A React and Vite storefront for original paintings, studio pottery, and wall mural services. The project includes an Express API backed by PostgreSQL and customer/studio authentication.

## Requirements

- Node.js compatible with Vite 8 and npm
- PostgreSQL database configured for this application
- Database connection details and a private JWT signing secret

## Install on a clean machine

From the project root:

    npm ci
    npm --prefix server ci
    cp server/.env.example server/.env

Edit server/.env privately and set DATABASE_URL and JWT_SECRET. Do not paste either value into source files, screenshots, issue reports, or Git.

The frontend has no .env variables. Its API base URL is configured in src/api.js as http://localhost:3000.

## Database prerequisite

The backend expects the tables and columns referenced by server/server.js. This repository does not include a verified database provisioning or seed command. Do not assume a new database is ready, and do not run the unified checkout migration as part of this setup without separately reviewing the target schema and obtaining the required approval.

The current mixed-cart checkout is a browser-local feature. It stores checkout records in localStorage; these orders are not persisted to PostgreSQL, visible to studio staff, or synchronized to other devices. The backend checkout route is present but requires schema changes described in server/migrations/001_unified_checkout.sql. That migration has not been applied or verified as applied. Existing standalone painting purchase, mural booking, and pottery request routes use the database, subject to the target database having the schema those routes expect.

## Start the backend and frontend

In one terminal, from the project root:

    npm --prefix server run dev

The API listens at http://localhost:3000.

In a second terminal, from the project root:

    npm run dev

Vite prints the frontend URL, normally http://localhost:5173. The configured API URL is localhost:3000, so use the app with the backend running locally.

## Studio account setup

There is no public studio registration flow. The private setup script prompts for an email and password and creates a studio-role account in the configured database:

    cd server
    node create-studio-account.js

Only run this when a studio account is needed and after confirming the configured database is the intended target. This script writes to the database. It is not required for customer registration or frontend build verification.

## Project checks

    npm run build
    npm run lint

There are no checked-in automated test files or working test suite command. The backend package's test script is a placeholder that exits with an error. No live database test is implied by a successful frontend build.

## Project structure

- src: React app, API client, authentication, cart, and local checkout history
- server: Express API, database-backed workflows, account setup script, and migration file
- seedData/seed.json: reference artwork and service catalogue data; it is not a database seeding script
- public/images: artwork images
- README.md and DESIGN.md: setup and implementation notes

## Security notes

- Public registration creates customer accounts only.
- Studio accounts are created through the private script, never through public registration.
- Environment files are ignored by Git; only placeholder examples should be committed.
- Do not commit credentials, database connection strings, JWTs, or real account passwords.
- The seed JSON contains catalogue data only. Studio login credentials must be entered privately through the setup script.
