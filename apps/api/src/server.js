import { config } from './config.js';
import { createApp } from './app.js';
import { startScheduler } from './jobs/scheduler.js';

createApp().listen(config.port, () => {
  console.log(JSON.stringify({ level: 'info', message: 'api started', port: config.port }));
});

startScheduler();
