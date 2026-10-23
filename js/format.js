// Định dạng và chuẩn hóa dùng chung (SPEC 3: giờ Việt Nam, tiếng Việt)

export const WEEKDAYS = [2, 3, 4, 5, 6, 7, 8];
export const WEEKDAY_LABELS = { 2: 'T2', 3: 'T3', 4: 'T4', 5: 'T5', 6: 'T6', 7: 'T7', 8: 'CN' };

export function formatWeekdays(days) {
  return [...(days ?? [])].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d]).join(', ') || '—';
}

// 'YYYY-MM-DD' → 'dd/mm/yyyy'
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Hôm nay theo giờ Việt Nam, dạng 'YYYY-MM-DD'
export function vnToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

// Giống public.normalize_name ở database (SPEC 6.1). Chỉ dùng để tìm kiếm và báo trùng tên trên giao diện;
// tra cứu của phụ huynh vẫn chuẩn hóa ở database.
export function normalizeName(s) {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Dọn tên như trigger ở database: bỏ khoảng trắng thừa
export function cleanName(s) {
  return (s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}
