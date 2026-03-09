import { Bot, session } from "grammy";
import { MyContext, registerHandlers } from "./handlers/budget";
import { SessionData, initialSession } from "./types/session";
import { allowedOnly } from "./middlewares/allowedOnly";
import { config } from "./config";

export function createBot(): Bot<MyContext> {
  const bot = new Bot<MyContext>(config.botToken);

  bot.use(session({ initial: initialSession }));
  bot.use(allowedOnly);

  registerHandlers(bot);

  bot.catch((err) => {
    console.error(
      `❌ Error for update ${err.ctx.update.update_id}:`,
      err.error,
    );
  });

  return bot;
}
