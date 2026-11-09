import express from 'express';
import cookieParser from 'cookie-parser';
import {
  errorHandler,
  notFoundHandler,
  requestLog,
  requireCsrfHeader,
} from './middleware/common.js';
import { requireAuth } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { businessRouter } from './routes/settings.js';
import { accountsRouter } from './routes/accounts.js';
import { categoriesRouter, rulesRouter, tagsRouter } from './routes/categories.js';
import { transactionsRouter } from './routes/transactions.js';
import { productsRouter, salesRouter } from './routes/commerce.js';
import { dashboardRouter, exportRouter, reportsRouter } from './routes/finance.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestLog);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', requireCsrfHeader);

  app.use('/api/auth', authRouter);

  const authenticated = express.Router();
  authenticated.use(requireAuth);
  authenticated.use('/business', businessRouter);
  authenticated.use('/accounts', accountsRouter);
  authenticated.use('/categories', categoriesRouter);
  authenticated.use('/category-rules', rulesRouter);
  authenticated.use('/tags', tagsRouter);
  authenticated.use('/transactions', transactionsRouter);
  authenticated.use('/products', productsRouter);
  authenticated.use('/sales', salesRouter);
  authenticated.use('/dashboard', dashboardRouter);
  authenticated.use('/reports', reportsRouter);
  authenticated.use('/export', exportRouter);
  app.use('/api', authenticated);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
