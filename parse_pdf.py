#!/usr/bin/env python3
"""
PDF Statement Parser using pdfplumber.
Reads PDF from stdin or file path, outputs JSON to stdout.
Usage: python3 parse_pdf.py <path_to_pdf>
"""

import sys
import json
import re
import pdfplumber
from datetime import datetime


def detect_bank(text: str) -> str:
    t = text.lower()
    if 'отп' in t or 'otpbank' in t or 'отп банк' in t:
        return 'ОТП Банк'
    if 'сбербанк' in t or 'sberbank' in t:
        return 'Сбербанк'
    if 'тинькофф' in t or 'tinkoff' in t or 'т-банк' in t:
        return 'Тинькофф'
    if 'втб' in t or 'vtb' in t:
        return 'ВТБ'
    if 'альфа' in t or 'alfa' in t:
        return 'Альфа-Банк'
    return 'Банк (не определён)'


def detect_type(operation: str) -> str:
    op = operation.lower()
    income_keywords = [
        'перевод средств', 'обмен бонусов', 'возврат',
        'зачисление', 'выплата', 'поступление', 'кэшбэк', 'cashback'
    ]
    for kw in income_keywords:
        if kw in op:
            return 'income'
    return 'expense'


def guess_category(description: str) -> str:
    d = description.lower()
    if re.search(r'krasnoe|beloe|globus|dixy|пятёрочк|магнит|перекрёст|вкусвилл|vkusvill|ашан|лента|sp_voda|alyonka|nastoishnaya', d):
        return 'Продукты'
    if re.search(r'metro|moskva metro|метро|автобус|трамвай|такси|uber|azs|азс|топливо|бензин|potapovo', d):
        return 'Транспорт'
    if re.search(r'жкх|коммунал|электр|газ|отопление|квартплат', d):
        return 'ЖКХ'
    if re.search(r'aptechnoe|аптек|фармац|apteka', d):
        return 'Аптека'
    if re.search(r'restoran|кафе|cafe|kafe|freshkafe|grabli|грабли|qsr|gopoedim|доставк|burger', d):
        return 'Рестораны'
    if re.search(r'teatr|кино|театр|развлеч|spotify|netflix|steam|budushego', d):
        return 'Развлечения'
    if re.search(r'одежд|обувь|zara|h&m|спортмастер', d):
        return 'Одежда'
    if re.search(r'мтс|билайн|мегафон|теле2|связь|интернет', d):
        return 'Связь'
    if re.search(r'комиссия|обслуживание|смс', d):
        return 'Комиссии'
    if re.search(r'перевод средств|между своими|сбп', d):
        return 'Переводы'
    return 'Прочее'


def parse_amount(s: str) -> float | None:
    """Parse amount string like '1234.56' or '1 234,56'"""
    if not s:
        return None
    cleaned = s.strip().replace(' ', '').replace(',', '.')
    # Remove any non-numeric except dot and minus
    cleaned = re.sub(r'[^\d.]', '', cleaned)
    try:
        val = float(cleaned)
        return val if val > 0 else None
    except ValueError:
        return None


def parse_date(s: str) -> str | None:
    """Parse DD.MM.YYYY to ISO format"""
    if not s:
        return None
    m = re.match(r'(\d{2})\.(\d{2})\.(\d{4})', s.strip())
    if not m:
        return None
    try:
        dt = datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), 12, 0, 0)
        return dt.isoformat() + 'Z'
    except ValueError:
        return None


def clean_operation(op: str) -> str:
    """Clean up operation name for display"""
    op = re.sub(r'^покупка\s+\.?', '', op, flags=re.IGNORECASE)
    op = re.sub(r'^оплата через сбп\s*', 'СБП ', op, flags=re.IGNORECASE)
    op = re.sub(r'^оплата комиссии\s*', 'Комиссия ', op, flags=re.IGNORECASE)
    op = re.sub(r'^обмен бонусов на рубли\s*', 'Бонусы → рубли', op, flags=re.IGNORECASE)
    return op.strip()


def parse_pdf(pdf_path: str) -> dict:
    transactions = []
    all_text = ''
    errors = []

    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                # Extract full text for bank/period detection
                page_text = page.extract_text() or ''
                all_text += page_text + '\n'

                # Extract table from page
                print(f"Page {page.page_number}: found {len(page.extract_tables())} tables", file=sys.stderr)
                words = page.extract_words()
                print(f"Page {page.page_number}: first 5 words: {words[:5]}", file=sys.stderr)
                tables = page.extract_tables()
                for table in tables:
                    for row in table:
                        if not row:
                            continue

                        # Clean all cells
                        cells = [str(c).strip() if c else '' for c in row]

                        # Skip header row
                        if any(h in cells[0].lower() for h in ['номер', 'дата', '#']):
                            continue

                        # OTP Bank table structure:
                        # [0] Номер  [1] Дата операции  [2] Операция  [3] Расход  [4] Приход  [5] Назначение
                        # We need at least 5 columns
                        if len(cells) < 5:
                            continue

                        # Skip rows without a date
                        date_str = parse_date(cells[1])
                        if not date_str:
                            continue

                        operation = cells[2].strip()
                        if not operation:
                            continue

                        expense_raw = cells[3].strip() if len(cells) > 3 else ''
                        income_raw = cells[4].strip() if len(cells) > 4 else ''

                        expense = parse_amount(expense_raw)
                        income = parse_amount(income_raw)

                        # Determine type and amount from columns
                        if income and income > 0 and (not expense or expense == 0):
                            tx_type = 'income'
                            amount = income
                        elif expense and expense > 0:
                            tx_type = 'expense'
                            amount = expense
                        else:
                            # Fallback: detect from operation name
                            tx_type = detect_type(operation)
                            amount = income or expense
                            if not amount:
                                continue

                        description = clean_operation(operation)
                        category = guess_category(description) if tx_type == 'expense' else 'Доход'

                        transactions.append({
                            'date': date_str,
                            'description': description,
                            'amount': round(amount, 2),
                            'type': tx_type,
                            'category': category,
                        })

    except Exception as e:
        errors.append(f'Ошибка при парсинге: {str(e)}')

    # Detect bank and period from text
    bank_name = detect_bank(all_text)

    period_from = None
    period_to = None
    period_match = re.search(
        r'за период с[:\s]+(\d{2}\.\d{2}\.\d{4})[^\d]+(\d{2}\.\d{2}\.\d{4})',
        all_text, re.IGNORECASE
    )
    if period_match:
        period_from = period_match.group(1)
        period_to = period_match.group(2)

    if not transactions and not errors:
        errors.append('Не удалось извлечь транзакции из таблицы PDF.')

    return {
        'transactions': transactions,
        'bankName': bank_name,
        'periodFrom': period_from,
        'periodTo': period_to,
        'errors': errors,
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'transactions': [], 'bankName': '', 'errors': ['No PDF path provided']}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    result = parse_pdf(pdf_path)
    print(json.dumps(result, ensure_ascii=False))
