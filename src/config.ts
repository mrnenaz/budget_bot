import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env variable: ${key}`);
  return value;
}

export const config = {
  botToken: required('BOT_TOKEN'),
  mongoUri: required('MONGODB_URI'),
  adminId: Number(required('ADMIN_TELEGRAM_ID')),
};
