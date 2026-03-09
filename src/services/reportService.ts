import {
  getPeriod,
  getTransactions,
  getTotalByType,
  getCategoryStats,
  getTopExpenses,
  formatAmount,
  formatDate,
  PeriodFilter,
} from './transactionService';

export type ReportPeriod = 'week' | 'month' | 'year';

function periodLabel(period: ReportPeriod, filter: PeriodFilter): string {
  const from = formatDate(filter.from);
  const to = formatDate(filter.to);
  const labels = { week: '📅 За неделю', month: '📅 За месяц', year: '📅 За год' };
  return `${labels[period]} (${from} — ${to})`;
}

export async function buildSummaryReport(period: ReportPeriod): Promise<string> {
  const filter = getPeriod(period);
  const totalIncome = await getTotalByType(filter, 'income');
  const totalExpense = await getTotalByType(filter, 'expense');
  const balance = totalIncome - totalExpense;
  const balanceSign = balance >= 0 ? '+' : '';

  let text = `📊 <b>Сводный отчёт</b>\n`;
  text += `${periodLabel(period, filter)}\n\n`;
  text += `💚 Доходы:  <b>${formatAmount(totalIncome)}</b>\n`;
  text += `❤️ Расходы: <b>${formatAmount(totalExpense)}</b>\n`;
  text += `━━━━━━━━━━━━━━━\n`;
  text += `${balance >= 0 ? '💰' : '⚠️'} Баланс: <b>${balanceSign}${formatAmount(balance)}</b>`;

  return text;
}

export async function buildCategoryReport(period: ReportPeriod): Promise<string> {
  const filter = getPeriod(period);
  const stats = await getCategoryStats(filter);

  if (stats.length === 0) {
    return `📂 Нет расходов за выбранный период.`;
  }

  const totalExpense = stats.reduce((s, r) => s + r.total, 0);

  let text = `📂 <b>Расходы по категориям</b>\n`;
  text += `${periodLabel(period, filter)}\n\n`;

  stats.forEach((s) => {
    const bar = '█'.repeat(Math.round(s.percent / 10)) + '░'.repeat(10 - Math.round(s.percent / 10));
    text += `${s.categoryName}\n`;
    text += `${bar} ${s.percent}% — <b>${formatAmount(s.total)}</b> (${s.count} оп.)\n\n`;
  });

  text += `━━━━━━━━━━━━━━━\n`;
  text += `Итого расходов: <b>${formatAmount(totalExpense)}</b>`;

  return text;
}

export async function buildTopReport(period: ReportPeriod): Promise<string> {
  const filter = getPeriod(period);
  const top = await getTopExpenses(filter, 10);

  if (top.length === 0) {
    return `🏆 Нет расходов за выбранный период.`;
  }

  let text = `🏆 <b>Топ расходов</b>\n`;
  text += `${periodLabel(period, filter)}\n\n`;

  top.forEach((t, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    text += `${medal} <b>${formatAmount(t.amount)}</b> — ${t.description}\n`;
    text += `   📂 ${t.categoryName || 'Прочее'} · ${formatDate(t.date)} · ${t.addedByName}\n\n`;
  });

  return text;
}

export async function buildRecentTransactions(): Promise<string> {
  const filter = getPeriod('month');
  const txs = await getTransactions(filter);
  const recent = txs.slice(0, 10);

  if (recent.length === 0) return '📭 Нет транзакций за текущий месяц.';

  let text = `📋 <b>Последние транзакции</b>\n\n`;
  recent.forEach((t) => {
    const sign = t.type === 'income' ? '💚 +' : '❤️ -';
    text += `${sign}<b>${formatAmount(t.amount)}</b> — ${t.description}\n`;
    text += `   📂 ${t.categoryName || '—'} · ${formatDate(t.date)} · ${t.addedByName}\n\n`;
  });

  return text;
}
