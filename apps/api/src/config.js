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
  logRequests: process.env.LOG_REQUESTS !== 'false',
  exportTimeoutMs: 60_000,
  sessionDays: 7,
};
