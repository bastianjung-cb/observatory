import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.OBSERVER_DATABASE_URL,
});

export default pool;
