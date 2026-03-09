import mongoose, { Document, Schema } from 'mongoose';

export interface ICategory extends Document {
  name: string;
  emoji: string;
  isDefault: boolean;
  createdBy?: number;
}

const CategorySchema = new Schema<ICategory>({
  name: { type: String, required: true },
  emoji: { type: String, required: true, default: '📦' },
  isDefault: { type: Boolean, default: false },
  createdBy: { type: Number },
});

export const Category = mongoose.model<ICategory>('Category', CategorySchema);

export const DEFAULT_CATEGORIES = [
  { name: 'Продукты', emoji: '🛒', isDefault: true },
  { name: 'Транспорт', emoji: '🚗', isDefault: true },
  { name: 'ЖКХ', emoji: '🏠', isDefault: true },
  { name: 'Здоровье', emoji: '🏥', isDefault: true },
  { name: 'Развлечения', emoji: '🎉', isDefault: true },
  { name: 'Одежда', emoji: '👗', isDefault: true },
  { name: 'Рестораны', emoji: '🍽', isDefault: true },
  { name: 'Аптека', emoji: '💊', isDefault: true },
  { name: 'Связь', emoji: '📱', isDefault: true },
  { name: 'Прочее', emoji: '📦', isDefault: true },
];

export async function seedCategories(): Promise<void> {
  const count = await Category.countDocuments({ isDefault: true });
  if (count === 0) {
    await Category.insertMany(DEFAULT_CATEGORIES);
    console.log('✅ Default categories seeded');
  }
}
