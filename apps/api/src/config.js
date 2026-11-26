function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const config = {
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(required('API_PORT')),
  databaseUrl: required('DATABASE_URL'),
  uploadDir: required('UPLOAD_DIR'),
  loginRateLimitPerMinute: Number(process.env.LOGIN_RATE_LIMIT ?? 10),
  registerRateLimitPerMinute: Number(process.env.REGISTER_RATE_LIMIT ?? 5),
  registerGlobalRateLimitPerMinute: Number(process.env.REGISTER_GLOBAL_RATE_LIMIT ?? 60),
  logRequests: process.env.LOG_REQUESTS !== 'false',
  exportTimeoutMs: 60_000,
  // One query may not hold a pooled connection longer than this, so one tenant cannot pin the pool.
  statementTimeoutMs: Number(process.env.STATEMENT_TIMEOUT_MS ?? 30_000),
  poolAcquireTimeoutMs: 10_000,
  sessionDays: 7,
  // A session keeps sliding while used, but never lives longer than this from sign-in.
  sessionMaxDays: 30,
};
