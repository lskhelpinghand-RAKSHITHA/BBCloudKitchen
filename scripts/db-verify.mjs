import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL to your Supabase PostgreSQL connection string.");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  max: 1,
  ssl: { rejectUnauthorized: true },
});

const requiredTables = [
  "menu_products",
  "product_portions",
  "product_availability",
  "product_customizations",
  "customization_options",
  "product_add_ons",
  "customers",
  "delivery_addresses",
  "promotions",
  "coupons",
  "orders",
  "order_line_items",
  "order_item_customizations",
  "order_item_add_ons",
  "fulfillments",
  "payment_records",
  "payment_refunds",
  "payment_webhook_events",
  "business_configuration",
  "authorized_administrators",
];

try {
  const connection = await pool.query(`
    SELECT current_database() AS database_name,
           current_user AS database_user,
           auth.uid() IS NULL AS auth_context_available
  `);
  const tableState = await pool.query(
    `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
    [requiredTables],
  );
  const policies = await pool.query(
    `SELECT tablename, count(*)::int AS count
     FROM pg_policies
     WHERE schemaname = 'public' AND tablename = ANY($1::text[])
     GROUP BY tablename`,
    [requiredTables],
  );
  const privileges = await pool.query(`
    SELECT has_table_privilege('anon', 'public.customers', 'SELECT') AS anon_can_read_customers,
           has_table_privilege('authenticated', 'public.customers', 'SELECT') AS authenticated_can_read_customers
  `);
  const operation = await pool.query(
    "SELECT 1::integer AS value WHERE 1 + 1 = 2",
  );
  const operationProbe = await pool.connect();
  let operationProbeDestroyed = false;
  let operationTransactionOpen = false;
  try {
    await operationProbe.query("BEGIN");
    operationTransactionOpen = true;
    await operationProbe.query(
      "CREATE TEMP TABLE bb_db_operation_probe (id integer PRIMARY KEY, value text) ON COMMIT DROP",
    );
    await operationProbe.query(
      "INSERT INTO bb_db_operation_probe (id, value) VALUES (1, 'created')",
    );
    await operationProbe.query(
      "UPDATE bb_db_operation_probe SET value = 'updated' WHERE id = 1",
    );
    const operationResult = await operationProbe.query(
      "SELECT value FROM bb_db_operation_probe WHERE id = 1",
    );
    if (operationResult.rows[0]?.value !== "updated") {
      throw new Error("Database write/read check returned an unexpected result.");
    }
    await operationProbe.query("ROLLBACK");
    operationTransactionOpen = false;
  } catch {
    if (operationTransactionOpen) {
      try {
      await operationProbe.query("ROLLBACK");
      } catch {
      operationProbe.release(true);
      operationProbeDestroyed = true;
      }
    }
    throw new Error("Database transaction/read/write check failed.");
  } finally {
    if (!operationProbeDestroyed) operationProbe.release();
  }
  const rlsProbe = await pool.connect();
  let anonymousCustomerRows;
  let authenticatedCustomerRows;
  let anonymousCustomerReadDenied = false;
  let rlsProbeDestroyed = false;
  try {
    await rlsProbe.query("BEGIN");
    await rlsProbe.query("SET LOCAL ROLE anon");
    try {
      const anonymousResult = await rlsProbe.query(
        "SELECT count(*)::int AS count FROM public.customers",
      );
      anonymousCustomerRows = anonymousResult.rows[0].count;
    } catch (error) {
      if (error.code !== "42501") throw error;
      anonymousCustomerReadDenied = true;
    }
    await rlsProbe.query("ROLLBACK");
    await rlsProbe.query("BEGIN");
    await rlsProbe.query("SET LOCAL ROLE authenticated");
    const authenticatedResult = await rlsProbe.query(
      "SELECT count(*)::int AS count FROM public.customers",
    );
    authenticatedCustomerRows = authenticatedResult.rows[0].count;
    await rlsProbe.query("ROLLBACK");
  } catch {
    try {
      await rlsProbe.query("ROLLBACK");
    } catch {
      rlsProbeDestroyed = true;
      rlsProbe.release(true);
    }
    throw new Error("RLS role probes could not be completed.");
  } finally {
    if (!rlsProbeDestroyed) rlsProbe.release();
  }

  const found = new Map(
    tableState.rows.map((row) => [row.table_name, row.rls_enabled]),
  );
  const missing = requiredTables.filter((table) => !found.has(table));
  const unprotected = [...found.entries()]
    .filter(([, rlsEnabled]) => !rlsEnabled)
    .map(([table]) => table);
  const policyTables = new Set(policies.rows.map((row) => row.tablename));
  const missingPolicies = requiredTables.filter((table) => !policyTables.has(table));

  console.log(`Connected to database: ${connection.rows[0].database_name}`);
  console.log(`Database role: ${connection.rows[0].database_user}`);
  console.log(`Database query check: ${operation.rows[0].value === 1 ? "passed" : "failed"}`);
  console.log(`Required tables: ${missing.length ? `missing ${missing.join(", ")}` : "present"}`);
  console.log(`RLS: ${unprotected.length ? `disabled on ${unprotected.join(", ")}` : `${found.size} required tables enabled`}`);
  console.log(`RLS policies: ${missingPolicies.length ? `missing for ${missingPolicies.join(", ")}` : `present on all ${requiredTables.length} tables`}`);
  console.log(`Anonymous customer read: ${privileges.rows[0].anon_can_read_customers ? "UNSAFE" : "denied"}`);
  console.log(`Authenticated customer read (requires admin RLS policy): ${privileges.rows[0].authenticated_can_read_customers ? "granted" : "denied"}`);
  console.log(`Anonymous RLS customer rows: ${anonymousCustomerRows}`);
  console.log(`Anonymous customer read probe: ${anonymousCustomerReadDenied ? "denied by database permissions" : "query succeeded under RLS"}`);
  console.log(`Unauthenticated authenticated-role RLS customer rows: ${authenticatedCustomerRows}`);

  if (
    missing.length ||
    unprotected.length ||
    missingPolicies.length > 0 ||
    privileges.rows[0].anon_can_read_customers ||
    (!anonymousCustomerReadDenied && anonymousCustomerRows !== 0) ||
    authenticatedCustomerRows !== 0
  ) {
    process.exitCode = 1;
  }
} catch {
  console.error("Database verification failed. Check connection, applied migrations, Supabase roles, and schema permissions.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
