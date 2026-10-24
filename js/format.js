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

// Thứ của một ngày 'YYYY-MM-DD' theo quy ước của lớp: 2 = Thứ 2 … 8 = CN (không phụ thuộc múi giờ máy)
export function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 8 : w + 1;
}

// Cộng/trừ ngày cho chuỗi 'YYYY-MM-DD'
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Tên gọi theo thứ tự Việt: sắp theo tên (từ cuối) rồi tới họ tên đầy đủ
export function compareVnNames(a, b) {
  const last = (s) => s.trim().split(/\s+/).pop();
  return last(a).localeCompare(last(b), 'vi') || a.localeCompare(b, 'vi');
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
