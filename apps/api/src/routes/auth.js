import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { handle } from '../lib/http.js';
import { tooManyRequests } from '../lib/errors.js';
import { parse } from '../lib/schemas.js';
import { perMinuteLimiter, secondsToNextMinute } from '../middleware/common.js';
import { requireAuth, SESSION_COOKIE } from '../middleware/auth.js';
import * as auth from '../services/auth.js';

export const authRouter = Router();

const email = z.string().trim().toLowerCase().email().max(255);
const password = z.string().min(8).max(200);

const registerSchema = z.object({
  business_name: z.string().trim().min(2).max(100),
  name: z.string().trim().min(2).max(100),
  email,
  password,
});
const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: password,
});

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    maxAge: config.sessionDays * 86_400_000,
    path: '/',
  });
}

const allowLoginAttempt = perMinuteLimiter(config.loginRateLimitPerMinute);
const allowRegister = perMinuteLimiter(config.registerRateLimitPerMinute);
const allowRegisterGlobally = perMinuteLimiter(config.registerGlobalRateLimitPerMinute);
const allowPasswordCheck = perMinuteLimiter(config.loginRateLimitPerMinute);

const TOO_MANY = 'Terlalu banyak percobaan. Tunggu satu menit.';
const rateLimited = () => tooManyRequests(TOO_MANY, secondsToNextMinute());

authRouter.post(
  '/register',
  handle(async (req, res) => {
    const body = parse(registerSchema, req.body);
    // Checked before hashing, so a flood of sign-ups cannot occupy the shared hashing threads.
    if (!allowRegister(`ip:${req.ip}`) || !allowRegisterGlobally('all')) throw rateLimited();
    const { token, user } = await auth.register(body);
    setSessionCookie(res, token);
    res.status(201).json({ user, message: 'Akun berhasil dibuat. Selamat datang di usahaku.' });
  }),
);

authRouter.post(
  '/login',
  handle(async (req, res) => {
    const body = parse(loginSchema, req.body);
    if (!allowLoginAttempt(`ip:${req.ip}`) || !allowLoginAttempt(`email:${body.email}`)) {
      throw rateLimited();
    }
    const { token, user } = await auth.login(body);
    setSessionCookie(res, token);
    res.json({ user });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  handle(async (req, res) => {
    await auth.logout(req.cookies[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  handle(async (req, res) => {
    const body = parse(changePasswordSchema, req.body);
    if (!allowPasswordCheck(`user:${req.user.id}`)) throw rateLimited();
    await auth.changePassword(req.user, body);
    res.json({ message: 'Kata sandi berhasil diubah.' });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  handle(async (req, res) => {
    const { id, name, email: userEmail } = req.user;
    res.json({
      user: { id, name, email: userEmail },
      business: { name: req.user.business_name, period_start_day: req.user.period_start_day },
    });
  }),
);
