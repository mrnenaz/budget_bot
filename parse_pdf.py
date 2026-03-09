#!/usr/bin/env python3
"""
PDF Statement Parser using pdfplumber word coordinates.
Works with PDFs that have no explicit table borders (like OTP Bank).

Column X ranges (from debug data):
  Номер:      x0 ~  56 –  115
  Дата:       x0 ~ 116 –  202
  Операция:   x0 ~ 203 –  367
  Расход:     x0 ~ 368 –  489
  Приход:     x0 ~ 490 –  650
  Назначение: x0 ~ 651 – 9999
"""

import sys
import json
import re
import pdfplumber
from datetime import datetime


# ── Column X boundaries ──────────────────────────────────────────────────────
COL_NUM       = (56,  115)
COL_DATE      = (116, 202)
COL_OPERATION = (203, 367)
COL_EXPENSE   = (368, 489)
COL_INCOME    = (490, 650)
# anything beyond 650 is "Назначение" — we don't need it


def in_col(x0: float, col: tuple) -> bool:
    return col[0] <= x0 < col[1]


def detect_bank(text: str) -> str:
    t = text.lower()
    if 'отп' in t or 'otpbank' in t:
        return 'ОТП Банк'
    if 'сбербанк' in t or 'sberbank' in t:
        return 'Сбербанк'
    if 'тинькофф' in t or 'tinkoff' in t:
        return 'Тинькофф'
    if 'втб' in t or 'vtb' in t:
        return 'ВТБ'
    if 'альфа' in t or 'alfa' in t:
        return 'Альфа-Банк'
    return 'Банк (не определён)'


def detect_type(operation: str) -> str:
    op = operation.lower()
    for kw in ['перевод средств', 'обмен бонусов', 'возврат', 'зачисление',
               'выплата', 'поступление', 'кэшбэк', 'cashback']:
        if kw in op:
            return 'income'
    return 'expense'


def guess_category(description: str) -> str:
    d = description.lower()
    if re.search(r'krasnoe|beloe|globus|dixy|пятёрочк|магнит|перекрёст|вкусвилл|vkusvill|sp_voda|alyonka|nastoishnaya', d):
        return 'Продукты'
    if re.search(r'moskva metro|метро|автобус|трамвай|такси|uber|azs|азс|бензин|potapovo', d):
        return 'Транспорт'
    if re.search(r'жкх|коммунал|электр|газ|отопление|квартплат', d):
        return 'ЖКХ'
    if re.search(r'aptechnoe|аптек|apteka', d):
        return 'Аптека'
    if re.search(r'restoran|кафе|freshkafe|grabli|qsr|gopoedim|доставк', d):
        return 'Рестораны'
    if re.search(r'teatr|кино|театр|spotify|netflix|steam|budushego', d):
        return 'Развлечения'
    if re.search(r'одежд|обувь|zara|спортмастер', d):
        return 'Одежда'
    if re.search(r'мтс|билайн|мегафон|теле2', d):
        return 'Связь'
    if re.search(r'комиссия|смс-информ', d):
        return 'Комиссии'
    if re.search(r'перевод средств|сбп', d):
        return 'Переводы'
    return 'Прочее'


def parse_amount(s: str):
    if not s:
        return None
    cleaned = re.sub(r'[^\d.]', '', s.replace(',', '.'))
    try:
        v = float(cleaned)
        return v if v > 0 else None
    except ValueError:
        return None


def parse_date(s: str):
    m = re.match(r'(\d{2})\.(\d{2})\.(\d{4})', s.strip())
    if not m:
        return None
    try:
        dt = datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), 12, 0, 0)
        return dt.isoformat() + 'Z'
    except ValueError:
        return None


def clean_operation(op: str) -> str:
    op = re.sub(r'^покупка\s+\.?', '', op, flags=re.IGNORECASE)
    op = re.sub(r'^оплата через сбп\s*', 'СБП ', op, flags=re.IGNORECASE)
    op = re.sub(r'^оплата комиссии\s*', 'Комиссия ', op, flags=re.IGNORECASE)
    op = re.sub(r'^обмен бонусов на рубли\s*', 'Бонусы → рубли', op, flags=re.IGNORECASE)
    return op.strip()


def group_words_into_rows(words: list, row_tolerance: float = 4.0) -> list:
    """Group words into rows by their vertical position (top coordinate)."""
    if not words:
        return []

    rows = []
    current_row = [words[0]]
    current_top = words[0]['top']

    for word in words[1:]:
        if abs(word['top'] - current_top) <= row_tolerance:
            current_row.append(word)
        else:
            rows.append(sorted(current_row, key=lambda w: w['x0']))
            current_row = [word]
            current_top = word['top']

    if current_row:
        rows.append(sorted(current_row, key=lambda w: w['x0']))

    return rows


def parse_pdf(pdf_path: str) -> dict:
    transactions = []
    all_text = ''
    errors = []

    try:
        with pdfplumber.open(pdf_path) as pdf:

            for page in pdf.pages:
                page_text = page.extract_text() or ''
                all_text += page_text + '\n'

                words = page.extract_words()
                if not words:
                    continue

                rows = group_words_into_rows(words)

                # Each transaction spans one or more rows:
                # - First row: num | date | operation_start | [expense] | [income]
                # - Next rows: operation_continuation (x0 in COL_OPERATION)
                #
                # We detect a new transaction row by: has a word in COL_NUM and a word in COL_DATE

                # Build transaction blocks
                blocks = []  # list of dicts: {date, operation_words, expense_words, income_words}
                current = None

                for row in rows:
                    num_words  = [w for w in row if in_col(w['x0'], COL_NUM)]
                    date_words = [w for w in row if in_col(w['x0'], COL_DATE)]
                    op_words   = [w for w in row if in_col(w['x0'], COL_OPERATION)]
                    exp_words  = [w for w in row if in_col(w['x0'], COL_EXPENSE)]
                    inc_words  = [w for w in row if in_col(w['x0'], COL_INCOME)]

                    # Check if this row starts a new transaction:
                    # must have a date-like word in COL_DATE
                    date_str = None
                    for w in date_words:
                        if re.match(r'\d{2}\.\d{2}\.\d{4}', w['text']):
                            date_str = w['text']
                            break

                    if date_str:
                        # Save previous block
                        if current:
                            blocks.append(current)
                        current = {
                            'date': date_str,
                            'op_words': op_words[:],
                            'exp_words': exp_words[:],
                            'inc_words': inc_words[:],
                        }
                    elif current and op_words and not exp_words and not inc_words:
                        # Continuation row for operation name (multi-line merchant names)
                        current['op_words'].extend(op_words)

                if current:
                    blocks.append(current)

                # Convert blocks to transactions
                for block in blocks:
                    date_iso = parse_date(block['date'])
                    if not date_iso:
                        continue

                    operation = ' '.join(w['text'] for w in block['op_words']).strip()
                    if not operation:
                        continue

                    expense_str = ' '.join(w['text'] for w in block['exp_words']).strip()
                    income_str  = ' '.join(w['text'] for w in block['inc_words']).strip()

                    expense = parse_amount(expense_str)
                    income  = parse_amount(income_str)

                    # Determine type and amount from columns
                    if income and (not expense or expense == 0):
                        tx_type = 'income'
                        amount = income
                    elif expense and expense > 0:
                        tx_type = 'expense'
                        amount = expense
                    else:
                        # Fallback: infer from operation name
                        tx_type = detect_type(operation)
                        amount = income or expense
                        if not amount:
                            continue

                    # Skip totals row (last row with no operation, just numbers)
                    if not re.search(r'[а-яёА-ЯЁa-zA-Z]', operation):
                        continue

                    description = clean_operation(operation)
                    category = guess_category(description) if tx_type == 'expense' else 'Доход'

                    transactions.append({
                        'date': date_iso,
                        'description': description,
                        'amount': round(amount, 2),
                        'type': tx_type,
                        'category': category,
                    })

    except Exception as e:
        errors.append(f'Ошибка при парсинге: {str(e)}')

    bank_name = detect_bank(all_text)

    period_from = None
    period_to = None
    m = re.search(
        r'за период с[:\s]+(\d{2}\.\d{2}\.\d{4})[^\d]+(\d{2}\.\d{2}\.\d{4})',
        all_text, re.IGNORECASE
    )
    if m:
        period_from = m.group(1)
        period_to = m.group(2)

    if not transactions and not errors:
        errors.append('Не удалось извлечь транзакции.')

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

    result = parse_pdf(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))