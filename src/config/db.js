const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
});

// Hostinger's default sql_mode is often non-strict, which means invalid ENUM
// values (or overflowed VARCHARs, etc.) get silently truncated to '' instead
// of raising an error. Force strict mode on every pooled connection so bad
// writes fail loudly instead of saving blank/corrupt data.
pool.on('connection', (conn) => {
  conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
});

module.exports = pool;
