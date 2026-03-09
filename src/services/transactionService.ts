import { Transaction, ITransaction, TransactionType } from '../db/models/Transaction';

export interface PeriodFilter {
  from: Date;
  to: Date;
}

export function getPeriod(period: 'week' | 'month' | 'year'): PeriodFilter {
  const now = new Date();
  const from = new Date(now);

  if (period === 'week') {
    from.setDate(from.getDate() - 7);
  } else if (period === 'month') {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  } else {
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
  }

  return { from, to: now };
}

export async function getTransactions(filter: PeriodFilter, type?: TransactionType): Promise<ITransaction[]> {
  const query: Record<string, unknown> = {
    date: { $gte: filter.from, $lte: filter.to },
  };
  if (type) query.type = type;
  return Transaction.find(query).sort({ date: -1 });
}

export async function getTotalByType(filter: PeriodFilter, type: TransactionType): Promise<number> {
  const result = await Transaction.aggregate([
    { $match: { type, date: { $gte: filter.from, $lte: filter.to } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return result[0]?.total ?? 0;
}

export interface CategoryStat {
  categoryName: string;
  total: number;
  count: number;
  percent: number;
}

export async function getCategoryStats(filter: PeriodFilter): Promise<CategoryStat[]> {
  const result = await Transaction.aggregate([
    {
      $match: {
        type: 'expense',
        date: { $gte: filter.from, $lte: filter.to },
      },
    },
    {
      $group: {
        _id: '$categoryName',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ]);

  const grandTotal = result.reduce((s, r) => s + r.total, 0);

  return result.map((r) => ({
    categoryName: r._id || 'Без категории',
    total: r.total,
    count: r.count,
    percent: grandTotal > 0 ? Math.round((r.total / grandTotal) * 100) : 0,
  }));
}

export async function getTopExpenses(filter: PeriodFilter, limit = 5): Promise<ITransaction[]> {
  return Transaction.find({
    type: 'expense',
    date: { $gte: filter.from, $lte: filter.to },
  })
    .sort({ amount: -1 })
    .limit(limit);
}

export function formatAmount(amount: number): string {
  return amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '.').replace(/[^\d.]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) return null;
  return Math.round(num * 100) / 100;
}

export function parseDate(input: string): Date | null {
  const match = input.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  const date = new Date(`${y}-${m}-${d}T12:00:00.000Z`);
  if (isNaN(date.getTime())) return null;
  return date;
}
