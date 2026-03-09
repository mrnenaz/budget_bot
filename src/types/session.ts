export type BotStep =
  | 'idle'
  | 'add_expense:amount'
  | 'add_expense:category'
  | 'add_expense:description'
  | 'add_expense:date'
  | 'add_income:amount'
  | 'add_income:description'
  | 'add_income:date'
  | 'add_category:name'
  | 'add_category:emoji'
  | 'pdf:confirm_import';

export interface SessionData {
  step: BotStep;
  draft: Record<string, unknown> & {
    transactions?: Array<{
      date: Date;
      description: string;
      amount: number;
      type: 'income' | 'expense';
      category?: string;
    }>;
  };
}

export function initialSession(): SessionData {
  return { step: 'idle', draft: {} };
}
