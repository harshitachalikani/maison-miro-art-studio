# MAISON MIRO — Design, Architecture, and Assignment Notes

## Architecture

The customer interface is React 19 with Vite 8. It calls an Express 5 API, which uses PostgreSQL through node-postgres. Authentication uses bcrypt password hashes and signed JWTs. The backend reads DATABASE_URL and JWT_SECRET from the server environment.

The API client currently targets http://localhost:3000. The frontend's painting collection, pottery catalogue, glazes, standalone mural booking, and standalone pottery request flows call API endpoints. The application also contains a mixed-cart checkout flow stored in browser localStorage; that flow is separate from the PostgreSQL-backed routes.

## Assignment question 1: How are login and roles handled?

Customers register through the public registration endpoint. The server hashes passwords with bcrypt and assigns the customer role itself, ignoring any role supplied by the client. Login verifies the password hash and returns a signed token. The frontend stores the token in sessionStorage and checks it through the authenticated current-user endpoint after reload.

Studio accounts are not created through public registration. The server-side setup script prompts for the email and password and inserts a studio-role account into the configured database. It should only be run after checking that the database target is correct.

Protected API routes enforce access on the server: missing or invalid tokens receive 401, and a valid token with the wrong role receives 403. Customer data routes scope database queries to the token's user ID. Studio administration endpoints require the studio role. Client-side route guards improve navigation but are not the authorization boundary.

## Assignment question 2: Which database is used?

The backend is configured for PostgreSQL and supports a Supabase PostgreSQL connection through DATABASE_URL. PostgreSQL is the persistent store for accounts, painting records, standalone painting orders, mural bookings, and pottery requests, when the required schema exists and the database is reachable.

The repository does not provide a verified provisioning or seed process. The JSON file in seedData is reference/catalogue data, not a database seeding script. Database contents and schema must be checked separately; this document does not claim that a live Supabase project was queried.

## Assignment question 3: How are duplicate painting purchases and date bookings prevented?

For database-backed painting purchase, the backend checks that a painting is available while holding a PostgreSQL row lock, then inserts the order and updates painting availability in one transaction. The design has documented a partial unique index as an additional database guard, but this repository does not include a migration that creates that painting index. Its existence in a particular database must be verified.

For database-backed wall bookings, the server validates the requested date and catches PostgreSQL unique-constraint conflicts. The design documents a partial unique index for active bookings on a date, but this repository does not include verified provisioning for that index. Do not assume the live database enforces date uniqueness until its schema is checked.

The mixed-cart checkout route has a checkout-key idempotency mechanism and transactional price/inventory handling in server code. It relies on columns and an order_items table added by server/migrations/001_unified_checkout.sql. That migration is not documented as applied and was not run for this submission preparation.

The current customer mixed-cart checkout in the frontend does not call that route. It writes one checkout record per bag into browser localStorage and prevents a repeated submit within the current page interaction. Local orders are not shared, cannot protect global inventory, and are not visible in the studio admin database screens. A locally recorded painting can appear Sold in that browser; this is not database inventory.

## Assignment question 4: What is complete, what is limited, and what comes next?

### Implemented in the current code

- Customer registration, login, logout, token verification, and server-side role checks.
- Database-backed painting, pottery catalogue, and glaze reads.
- Database-backed standalone painting purchase and cancellation routes with transactional availability changes.
- Database-backed mural booking, estimate, customer history/cancellation, and studio confirm/decline endpoints.
- Database-backed pottery request, customer history/edit/cancel, and studio accept/decline endpoints.
- A mixed-cart interface with COD, delivery details, one local order per checkout, item detail, and whole-order local cancellation.
- Loading, empty, and error feedback on the main customer collection, artwork, request, checkout, and order screens.

### Important limitations and unverified items

- Mixed-cart checkout records are browser-local. They are not PostgreSQL orders, are not visible to studio staff, and do not synchronize across devices.
- The backend unified checkout requires the unapplied migration in server/migrations/001_unified_checkout.sql. Do not treat it as operational against a database that has not been checked for those columns and table.
- The project has no checked-in automated test suite. The backend npm test script is a placeholder. No live database or end-to-end workflows were tested for this document.
- The README and seed JSON do not provision or seed a database. Database schema, seed data, and documented unique indexes must be verified independently.
- The application frontend uses a fixed localhost API URL. Production hosting requires a deliberate API URL and deployment configuration update.

### Recommended next steps

1. Confirm the target PostgreSQL schema and indexes using read-only inspection before deciding whether any schema work is needed.
2. Choose whether checkout should remain explicitly local-only or be moved to the backend after a reviewed, compatible schema update.
3. Add repeatable, non-production tests for authentication, authorization, purchases/cancellation, bookings, pottery requests, and checkout.
4. Update deployment configuration and documentation after verifying the actual database setup.

## Environment variables

The backend requires DATABASE_URL and JWT_SECRET. Placeholder values are provided in server/.env.example. Keep actual values only in the ignored server/.env file or a secret manager. The frontend currently defines no Vite environment variables.
