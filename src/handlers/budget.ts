import { Bot, Context, InlineKeyboard, session, SessionFlavor } from 'grammy';
import { SessionData, initialSession } from '../types/session';
import { Transaction } from '../db/models/Transaction';
import { Category } from '../db/models/Category';
import { parsePdfStatement, guessCategory } from '../services/pdfService';
import {
  parseAmount,
  parseDate,
  formatAmount,
  formatDate,
} from '../services/transactionService';
import {
  buildSummaryReport,
  buildCategoryReport,
  buildTopReport,
  buildRecentTransactions,
  ReportPeriod,
} from '../services/reportService';
import { config } from '../config';

export type MyContext = Context & SessionFlavor<SessionData>;

function userName(ctx: Context): string {
  return ctx.from?.first_name || ctx.from?.username || 'Пользователь';
}

function userId(ctx: Context): number {
  return ctx.from?.id ?? 0;
}

export function registerHandlers(bot: Bot<MyContext>): void {

  // ── /start ──
  bot.command('start', async (ctx) => {
    await ctx.reply(
      `👋 Привет, <b>${userName(ctx)}</b>!\n\n` +
      `<b>Команды:</b>\n` +
      `/expense — ➖ Добавить расход\n` +
      `/income — ➕ Добавить доход\n` +
      `/report — 📊 Отчёты\n` +
      `/history — 📋 Последние транзакции\n` +
      `/categories — 📂 Управление категориями\n` +
      `/cancel — ❌ Отменить действие\n\n` +
      `📎 Для импорта выписки — просто отправьте PDF файл.`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /cancel ──
  bot.command('cancel', async (ctx) => {
    ctx.session = initialSession();
    await ctx.reply('❌ Действие отменено.');
  });

  // ── /expense ──
  bot.command('expense', async (ctx) => {
    ctx.session = { step: 'add_expense:amount', draft: {} };
    await ctx.reply('➖ <b>Добавление расхода</b>\n\nВведите сумму (например: 1500 или 1500.50):', {
      parse_mode: 'HTML',
    });
  });

  // ── /income ──
  bot.command('income', async (ctx) => {
    ctx.session = { step: 'add_income:amount', draft: {} };
    await ctx.reply('➕ <b>Добавление дохода</b>\n\nВведите сумму:', { parse_mode: 'HTML' });
  });

  // ── /report ──
  bot.command('report', async (ctx) => {
    const kb = new InlineKeyboard()
      .text('📊 Сводный', 'report_summary').row()
      .text('📂 По категориям', 'report_category').row()
      .text('🏆 Топ трат', 'report_top').row();

    await ctx.reply('📊 Выберите тип отчёта:', { reply_markup: kb });
  });

  // ── /history ──
  bot.command('history', async (ctx) => {
    const text = await buildRecentTransactions();
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  // ── /categories ──
  bot.command('categories', async (ctx) => {
    const categories = await Category.find().sort({ isDefault: -1, name: 1 });
    const kb = new InlineKeyboard()
      .text('➕ Добавить категорию', 'cat_add').row();

    // Admin can delete custom categories
    if (userId(ctx) === config.adminId) {
      kb.text('🗑 Удалить категорию', 'cat_delete').row();
    }

    let text = '📂 <b>Категории расходов:</b>\n\n';
    categories.forEach((c) => {
      text += `${c.emoji} ${c.name}${c.isDefault ? '' : ' (своя)'}\n`;
    });

    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  });

  // ── PDF document handler ──
  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.includes('pdf')) {
      await ctx.reply('❌ Поддерживаются только PDF файлы.');
      return;
    }

    const statusMsg = await ctx.reply('⏳ Обрабатываю выписку...');

    try {
      const file = await ctx.api.getFile(doc.file_id);
      const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;

      const res = await fetch(url);
      const buffer = Buffer.from(await res.arrayBuffer());

      const result = await parsePdfStatement(buffer);

      if (result.errors.length > 0 && result.transactions.length === 0) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `❌ Ошибка парсинга:\n${result.errors.join('\n')}`
        );
        return;
      }

      // Store pending transactions in session for confirmation
      ctx.session = {
        step: 'pdf:confirm_import',
        draft: {
          transactions: result.transactions,
          bankName: result.bankName,
        },
      };

      const incomeCount = result.transactions.filter((t) => t.type === 'income').length;
      const expenseCount = result.transactions.filter((t) => t.type === 'expense').length;
      const totalIncome = result.transactions
        .filter((t) => t.type === 'income')
        .reduce((s, t) => s + t.amount, 0);
      const totalExpense = result.transactions
        .filter((t) => t.type === 'expense')
        .reduce((s, t) => s + t.amount, 0);

      const kb = new InlineKeyboard()
        .text('✅ Импортировать', 'pdf_confirm')
        .text('❌ Отмена', 'pdf_cancel');

      const period = result.periodFrom && result.periodTo
        ? `\n📅 Период: ${result.periodFrom} — ${result.periodTo}`
        : '';

      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `📄 <b>Выписка: ${result.bankName}</b>${period}\n\n` +
        `Найдено транзакций: <b>${result.transactions.length}</b>\n` +
        `💚 Доходов: ${incomeCount} на ${formatAmount(totalIncome)}\n` +
        `❤️ Расходов: ${expenseCount} на ${formatAmount(totalExpense)}\n\n` +
        `Импортировать?`,
        { parse_mode: 'HTML', reply_markup: kb }
      );
    } catch (err) {
      console.error('PDF parse error:', err);
      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        '❌ Не удалось обработать файл.'
      );
    }
  });

  // ── Callbacks ──
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;

    // ── Report type select ──
    if (data.startsWith('report_')) {
      const type = data.replace('report_', '') as string;
      const periodKb = new InlineKeyboard()
        .text('📅 Неделя', `rp_${type}_week`)
        .text('📅 Месяц', `rp_${type}_month`)
        .text('📅 Год', `rp_${type}_year`);

      await ctx.editMessageText('Выберите период:', { reply_markup: periodKb });
      await ctx.answerCallbackQuery();
      return;
    }

    // ── Report period select ──
    if (data.startsWith('rp_')) {
      const [, type, period] = data.split('_');
      const p = period as ReportPeriod;

      let text = '';
      if (type === 'summary') text = await buildSummaryReport(p);
      else if (type === 'category') text = await buildCategoryReport(p);
      else if (type === 'top') text = await buildTopReport(p);

      await ctx.editMessageText(text, { parse_mode: 'HTML' });
      try { await ctx.answerCallbackQuery(); } catch {}
      return;
    }

    // ── Expense category select ──
    if (data.startsWith('cat_sel_')) {
      const catId = data.replace('cat_sel_', '');
      const cat = await Category.findById(catId);
      if (!cat) { try { await ctx.answerCallbackQuery(); } catch {} return; }

      ctx.session.draft.categoryId = catId;
      ctx.session.draft.categoryName = `${cat.emoji} ${cat.name}`;
      ctx.session.step = 'add_expense:description';

      await ctx.editMessageText('📝 Введите описание (или <code>нет</code>):', { parse_mode: 'HTML' });
      try { await ctx.answerCallbackQuery(); } catch {}
      return;
    }

    // ── Add category ──
    if (data === 'cat_add') {
      ctx.session = { step: 'add_category:name', draft: {} };
      await ctx.editMessageText('📂 Введите название новой категории:');
      try { await ctx.answerCallbackQuery(); } catch {}
      return;
    }

    // ── Delete category (admin) ──
    if (data === 'cat_delete') {
      if (userId(ctx) !== config.adminId) {
        try { await ctx.answerCallbackQuery({ text: '⛔ Только для администратора', show_alert: true }); } catch {}
        return;
      }
      const cats = await Category.find({ isDefault: false });
      if (cats.length === 0) {
        try { await ctx.answerCallbackQuery({ text: 'Нет пользовательских категорий', show_alert: true }); } catch {}
        return;
      }
      const kb = new InlineKeyboard();
      cats.forEach((c) => kb.text(`${c.emoji} ${c.name}`, `cat_del_${c._id}`).row());
      await ctx.editMessageText('Выберите категорию для удаления:', { reply_markup: kb });
      try { await ctx.answerCallbackQuery(); } catch {}
      return;
    }

    if (data.startsWith('cat_del_')) {
      const id = data.replace('cat_del_', '');
      await Category.findByIdAndDelete(id);
      await ctx.editMessageText('✅ Категория удалена.');
      try { await ctx.answerCallbackQuery(); } catch {}
      return;
    }

    // ── PDF confirm/cancel ──
    if (data === 'pdf_confirm') {
      const transactions = ctx.session.draft.transactions as Array<{
        date: Date; description: string; amount: number; type: 'income' | 'expense'; category?: string;
      }>;

      if (!transactions?.length) {
        await ctx.editMessageText('❌ Нет транзакций для импорта.');
        try { await ctx.answerCallbackQuery(); } catch {}
        return;
      }

      const docs = transactions.map((t) => ({
        type: t.type,
        amount: t.amount,
        categoryName: t.type === 'expense' ? (t.category || guessCategory(t.description)) : 'Доход',
        description: t.description,
        date: new Date(t.date),
        addedBy: userId(ctx),
        addedByName: userName(ctx),
        fromPdf: true,
      }));

      await Transaction.insertMany(docs);
      ctx.session = initialSession();

      await ctx.editMessageText(
        `✅ Импортировано <b>${docs.length}</b> транзакций!\n` +
        `Категории назначены автоматически.`,
        { parse_mode: 'HTML' }
      );
      try { await ctx.answerCallbackQuery(); } catch {}
      return;
    }

    if (data === 'pdf_cancel') {
      ctx.session = initialSession();
      await ctx.editMessageText('❌ Импорт отменён.');
      try { await ctx.answerCallbackQuery(); } catch {}
      return;
    }

    // ── Expense date shortcuts ──
    if (data === 'date_today') {
      await finishTransaction(ctx, new Date());
      try { await ctx.answerCallbackQuery(); } catch {}
      return;
    }
    if (data === 'date_manual') {
      ctx.session.step = ctx.session.draft.type === 'income'
        ? 'add_income:date'
        : 'add_expense:date';
      await ctx.editMessageText('📅 Введите дату в формате <code>ДД.ММ.ГГГГ</code>:', { parse_mode: 'HTML' });
      try { await ctx.answerCallbackQuery(); } catch {}
      return;
    }

    try { await ctx.answerCallbackQuery(); } catch {}
  });

  // ── FSM text handler ──
  bot.on('message:text', async (ctx) => {
    const step = ctx.session.step;
    const draft = ctx.session.draft;
    const text = ctx.message.text.trim();

    if (text.startsWith('/')) return;


    // ── EXPENSE FLOW ──
    if (step === 'add_expense:amount') {
      const amount = parseAmount(text);
      if (!amount) { await ctx.reply('❗ Введите корректную сумму, например: <code>1500</code>', { parse_mode: 'HTML' }); return; }

      draft.amount = amount;
      draft.type = 'expense';
      ctx.session.step = 'add_expense:category';

      const categories = await Category.find().sort({ isDefault: -1, name: 1 });
      const kb = new InlineKeyboard();
      categories.forEach((c) => kb.text(`${c.emoji} ${c.name}`, `cat_sel_${c._id}`).row());

      await ctx.reply('📂 Выберите категорию:', { reply_markup: kb });
      return;
    }

    if (step === 'add_expense:description') {
      draft.description = text === 'нет' ? 'Расход' : text;
      ctx.session.step = 'add_expense:date';
      await askDate(ctx);
      return;
    }

    if (step === 'add_expense:date') {
      const date = parseDate(text);
      if (!date) { await ctx.reply('❗ Формат: <code>ДД.ММ.ГГГГ</code>', { parse_mode: 'HTML' }); return; }
      await finishTransaction(ctx, date);
      return;
    }

    // ── INCOME FLOW ──
    if (step === 'add_income:amount') {
      const amount = parseAmount(text);
      if (!amount) { await ctx.reply('❗ Введите корректную сумму:', { parse_mode: 'HTML' }); return; }

      draft.amount = amount;
      draft.type = 'income';
      draft.categoryName = 'Доход';
      ctx.session.step = 'add_income:description';
      await ctx.reply('📝 Введите описание (или <code>нет</code>):', { parse_mode: 'HTML' });
      return;
    }

    if (step === 'add_income:description') {
      draft.description = text === 'нет' ? 'Доход' : text;
      ctx.session.step = 'add_income:date';
      await askDate(ctx);
      return;
    }

    if (step === 'add_income:date') {
      const date = parseDate(text);
      if (!date) { await ctx.reply('❗ Формат: <code>ДД.ММ.ГГГГ</code>', { parse_mode: 'HTML' }); return; }
      await finishTransaction(ctx, date);
      return;
    }

    // ── ADD CATEGORY FLOW ──
    if (step === 'add_category:name') {
      draft.catName = text;
      ctx.session.step = 'add_category:emoji';
      await ctx.reply('Введите эмодзи для категории (например 🎮) или напишите <code>нет</code>:', { parse_mode: 'HTML' });
      return;
    }

    if (step === 'add_category:emoji') {
      const emoji = text === 'нет' ? '📦' : text;
      await Category.create({ name: draft.catName, emoji, isDefault: false, createdBy: userId(ctx) });
      ctx.session = initialSession();
      await ctx.reply(`✅ Категория <b>${emoji} ${draft.catName}</b> добавлена!`, { parse_mode: 'HTML' });
      return;
    }
  });
}

async function askDate(ctx: MyContext): Promise<void> {
  const kb = new InlineKeyboard()
    .text('📅 Сегодня', 'date_today')
    .text('✏️ Ввести дату', 'date_manual');

  await ctx.reply('📅 Выберите дату:', { reply_markup: kb });
}

async function finishTransaction(ctx: MyContext, date: Date): Promise<void> {
  const draft = ctx.session.draft;

  await Transaction.create({
    type: draft.type,
    amount: draft.amount,
    categoryId: draft.categoryId,
    categoryName: draft.categoryName || 'Прочее',
    description: draft.description || (draft.type === 'income' ? 'Доход' : 'Расход'),
    date,
    addedBy: userId(ctx),
    addedByName: userName(ctx),
    fromPdf: false,
  });

  ctx.session = initialSession();

  const sign = draft.type === 'income' ? '💚 +' : '❤️ -';
  const typeLabel = draft.type === 'income' ? 'Доход' : 'Расход';

  await ctx.reply(
    `✅ <b>${typeLabel} добавлен!</b>\n\n` +
    `${sign}<b>${formatAmount(draft.amount as number)}</b>\n` +
    `📂 ${draft.categoryName || 'Прочее'}\n` +
    `📝 ${draft.description}\n` +
    `📅 ${formatDate(date)}`,
    { parse_mode: 'HTML' }
  );
}
