import mongoose, { Document, Schema } from 'mongoose';

export type TransactionType = 'income' | 'expense';

export interface ITransaction extends Document {
  type: TransactionType;
  amount: number;
  categoryId?: string;
  categoryName?: string;
  description: string;
  date: Date;
  addedBy: number;
  addedByName: string;
  fromPdf: boolean;
  createdAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    type: { type: String, enum: ['income', 'expense'], required: true },
    amount: { type: Number, required: true, min: 0 },
    categoryId: { type: String },
    categoryName: { type: String },
    description: { type: String, required: true },
    date: { type: Date, required: true, default: Date.now },
    addedBy: { type: Number, required: true },
    addedByName: { type: String, required: true },
    fromPdf: { type: Boolean, default: false },
  },
  { timestamps: true }
);

TransactionSchema.index({ date: -1 });
TransactionSchema.index({ type: 1, date: -1 });
TransactionSchema.index({ categoryId: 1, date: -1 });

export const Transaction = mongoose.model<ITransaction>('Transaction', TransactionSchema);
