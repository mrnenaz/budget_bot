import { connectDB } from './db/connection';
import { createBot } from './bot';
import { seedCategories } from './db/models/Category';

async function main(): Promise<void> {
  console.log('🚀 Starting Budget Bot...');

  await connectDB();
  await seedCategories();

  const bot = createBot();

  process.once('SIGINT', () => bot.stop());
  process.once('SIGTERM', () => bot.stop());

  await bot.start({
    onStart: (info) => {
      console.log(`✅ Bot @${info.username} is running`);
    },
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
