import { NextFunction } from "grammy";
import { MyContext } from "../handlers/budget";
import { config } from "../config";

export async function allowedOnly(
  ctx: MyContext,
  next: NextFunction,
): Promise<void> {
  // If no list configured — allow everyone (useful during initial setup)
  if (config.allowedUsers.length === 0) {
    return next();
  }

  const userId = ctx.from?.id;

  if (!userId || !config.allowedUsers.includes(userId)) {
    await ctx.reply(
      "🚫 Извини, этот бот только для членов нашей семьи.\n" +
        "Если ты считаешь, что это ошибка — обратись к администратору.",
    );
    return;
  }

  return next();
}
