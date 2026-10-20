/**
 * create-studio-account.js
 *
 * One-time script to create the studio/admin account.
 * Run from the server/ directory:
 *
 *   node create-studio-account.js
 *
 * You will be prompted for an email and password.
 * The password must be at least 8 characters.
 * The account will be created with role='studio'.
 *
 * SECURITY NOTES
 * ─────────────────────────────────────────────
 * • This script is NOT an API endpoint. It must only be run by
 *   the developer on the local machine.
 * • Never expose a public endpoint that creates studio accounts.
 * • After creating the account, keep the credentials secure.
 * • Never commit credentials to version control.
 */

require("dotenv").config();

const { Pool }  = require("pg");
const bcrypt    = require("bcryptjs");
const readline  = require("readline");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout
  });

  console.log("\n=== MAISON MIRO — Create Studio Account ===\n");

  const email    = (await ask(rl, "Studio email address: ")).trim().toLowerCase();
  const password =  await ask(rl, "Password (min 8 chars): ");
  rl.close();

  if (!email || !email.includes("@")) {
    console.error("❌ Invalid email address.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("❌ Password must be at least 8 characters.");
    process.exit(1);
  }

  try {
    // Check if the email is already registered
    const existing = await pool.query(
      "SELECT id, role FROM public.users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      console.error(`❌ An account for ${email} already exists (role=${existing.rows[0].role}).`);
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO public.users (email, password_hash, role)
       VALUES ($1, $2, 'studio')
       RETURNING id, email, role, created_at`,
      [email, passwordHash]
    );

    const user = result.rows[0];
    console.log("\n✅ Studio account created successfully.");
    console.log(`   ID:      ${user.id}`);
    console.log(`   Email:   ${user.email}`);
    console.log(`   Role:    ${user.role}`);
    console.log(`   Created: ${user.created_at}`);
    console.log("\n⚠️  Store the credentials securely. Do not commit them to version control.\n");
  } catch (err) {
    console.error("❌ Failed to create account:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
