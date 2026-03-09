import { execFile } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface ParsedTransaction {
  date: Date;
  description: string;
  amount: number;
  type: "income" | "expense";
  category: string;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  bankName: string;
  periodFrom?: string;
  periodTo?: string;
  errors: string[];
}

// Path to Python script — relative to project root
const PYTHON_SCRIPT = join(__dirname, "..", "..", "parse_pdf.py");

// Python binary path (pdfplumber installed to ~/.local)
const PYTHON_BIN = "/usr/bin/python3";

export async function parsePdfStatement(buffer: Buffer): Promise<ParseResult> {
  // Write buffer to a temp file
  const tmpPath = join(tmpdir(), `statement_${Date.now()}.pdf`);

  try {
    await writeFile(tmpPath, buffer);

    const { stdout, stderr } = await execFileAsync(
      PYTHON_BIN,
      [PYTHON_SCRIPT, tmpPath],
      {
        timeout: 30000, // 30 seconds max
        maxBuffer: 5 * 1024 * 1024, // 5MB output buffer
      },
    );

    console.log("Python stdout:", stdout.substring(0, 500));
    console.log("Python stderr:", stderr);
    if (stderr && stderr.trim()) {
      console.warn("Python parser stderr:", stderr);
    }

    const result = JSON.parse(stdout) as {
      transactions: Array<{
        date: string;
        description: string;
        amount: number;
        type: "income" | "expense";
        category: string;
      }>;
      bankName: string;
      periodFrom?: string;
      periodTo?: string;
      errors: string[];
    };

    // Convert date strings to Date objects
    const transactions: ParsedTransaction[] = result.transactions.map((t) => ({
      date: new Date(t.date),
      description: t.description,
      amount: t.amount,
      type: t.type,
      category: t.category,
    }));

    return {
      transactions,
      bankName: result.bankName,
      periodFrom: result.periodFrom,
      periodTo: result.periodTo,
      errors: result.errors || [],
    };
  } catch (err: any) {
    console.error("PDF parse error:", err);
    return {
      transactions: [],
      bankName: "Неизвестно",
      errors: [`Ошибка парсинга: ${err.message || "неизвестная ошибка"}`],
    };
  } finally {
    // Clean up temp file
    try {
      await unlink(tmpPath);
    } catch {}
  }
}

// Re-export guessCategory for backward compatibility
export function guessCategory(description: string): string {
  const d = description.toLowerCase();
  if (
    /krasnoe|beloe|globus|dixy|пятёрочк|магнит|перекрёст|вкусвилл|vkusvill|sp_voda|alyonka/.test(
      d,
    )
  )
    return "Продукты";
  if (/metro|moskva metro|метро|такси|uber|azs|азс|бензин|potapovo/.test(d))
    return "Транспорт";
  if (/жкх|коммунал|электр|газ/.test(d)) return "ЖКХ";
  if (/aptechnoe|аптек|apteka/.test(d)) return "Аптека";
  if (/restoran|кафе|freshkafe|grabli|qsr|gopoedim/.test(d)) return "Рестораны";
  if (/teatr|кино|театр|spotify|netflix|steam/.test(d)) return "Развлечения";
  if (/комиссия|смс/.test(d)) return "Комиссии";
  if (/перевод средств|сбп/.test(d)) return "Переводы";
  return "Прочее";
}
