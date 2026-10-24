// A6. Báo cáo (SPEC 7): theo tháng (tổng tiền, theo lớp, danh sách chưa đóng), theo khóa, xuất Excel / CSV
import { db } from '../db.js';
import { h } from '../dom.js';
import { q, loadTerms } from '../data.js';
import { formatMoney, formatDate, vnToday } from '../format.js';
import { monthChoices, monthLabel } from './hoc-phi.js';
import { button, busy, field, select, callout, toast } from '../ui.js';

const STATUS = {
  unpaid: ['Chưa đóng', 'pill pill--warning'],
  reported: ['Đã báo chuyển', 'pill pill--primary'],
  confirmed: ['Đã đóng', 'pill pill--success'],
};
const view = { tab: 'month', month: null, termId: null };   // giữ lựa chọn khi chuyển màn hình

// ---------- Xuất file ----------

const vnTime = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');

function exportRows({ invoices, attendance }) {
  return {
    invoices: [
      ['Mã HS', 'Họ và tên', 'Lớp', 'Số buổi', 'Số tiền', 'Nội dung chuyển khoản', 'Trạng thái', 'Tài khoản nhận', 'Báo chuyển lúc', 'Xác nhận lúc'],
      ...invoices.map((i) => [i.code, i.full_name, i.classes.join(', '), i.sessions_count, i.amount, i.transfer_note,
        STATUS[i.status][0], i.bank_label ?? '', vnTime(i.reported_at), vnTime(i.confirmed_at)]),
    ],
    attendance: [
      ['Ngày', 'Lớp', 'Mã HS', 'Họ và tên', 'Có mặt', 'Hình thức'],
      ...attendance.map((a) => [formatDate(a.date), a.class, a.code, a.full_name, a.present ? 'Có mặt' : 'Vắng', a.mode === 'online' ? 'Online' : 'Offline']),
    ],
  };
}

// CSV có BOM UTF-8 để Excel đọc đúng tiếng Việt
function toCsv(rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

function saveBlob(blob, filename) {
  const a = h('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

let xlsxLoading;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  xlsxLoading ??= new Promise((resolve, reject) => {
    const s = h('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.integrity = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { xlsxLoading = null; reject(new Error('Không tải được thư viện Excel. Kiểm tra mạng rồi thử lại, hoặc dùng nút CSV.')); };
    document.head.append(s);
  });
  return xlsxLoading;
}

async function fetchExport(month) {
  const [inv, attendance] = await Promise.all([
    q(db.rpc('month_invoices', { p_month: month })),
    q(db.rpc('month_attendance', { p_month: month })),
  ]);
  return exportRows({ invoices: inv.invoices, attendance });
}

async function exportXlsx(month) {
  const [XLSX, rows] = await Promise.all([loadXlsx(), fetchExport(month)]);
  const wb = XLSX.utils.book_new();
  const add = (name, data, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add('Hóa đơn', rows.invoices, [8, 26, 16, 8, 12, 44, 14, 18, 20, 20]);
  add('Điểm danh', rows.attendance, [12, 16, 8, 26, 10, 10]);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `hoc-phi-${month}.xlsx`);
}

async function exportCsv(month, which) {
  const rows = await fetchExport(month);
  saveBlob(new Blob([toCsv(rows[which])], { type: 'text/csv;charset=utf-8' }), `${which === 'invoices' ? 'hoa-don' : 'diem-danh'}-${month}.csv`);
}

// ---------- Giao diện ----------

const table = (headers, rows, totals) => {
  const t = h('table', 'table');
  const head = h('tr');
  headers.forEach(([label, cls]) => head.append(h('th', cls, label)));
  t.append(h('thead'), h('tbody'));
  t.tHead.append(head);
  for (const r of rows) {
    const tr = h('tr');
    r.forEach((v, i) => tr.append(h('td', headers[i][1], String(v))));
    t.tBodies[0].append(tr);
  }
  if (totals) {
    const tr = h('tr', 'is-total');
    totals.forEach((v, i) => tr.append(h('td', headers[i][1], String(v))));
    t.tBodies[0].append(tr);
  }
  const wrap = h('div', 'table-wrap');
  wrap.append(t);
  return wrap;
};

function statCards(items) {
  const cards = h('div', 'stats');
  for (const [label, value, note] of items) {
    const c = h('div', 'stat');
    c.append(h('span', 'stat__label', label), h('strong', 'stat__value', formatMoney(value)), h('span', 'muted small', note));
    cards.append(c);
  }
  return cards;
}

export async function renderBaoCao(el, ctx) {
  const title = h('h1', 'page-title', 'Báo cáo');
  el.replaceChildren(title, h('p', 'muted', 'Đang tải…'));

  let terms, closings;
  try {
    [terms, closings] = await Promise.all([loadTerms(), q(db.from('month_closings').select('month'))]);
  } catch (err) {
    el.replaceChildren(title, callout(err.message, 'error'));
    return;
  }
  const current = terms.find((t) => t.is_current);
  const closedMonths = closings.map((c) => c.month);
  const months = monthChoices(current, closedMonths);
  if (!months.includes(view.month)) view.month = months.includes(vnToday().slice(0, 7)) ? vnToday().slice(0, 7) : months[0];
  if (!terms.some((t) => t.id === view.termId)) view.termId = (current ?? terms[0])?.id;

  const tabs = h('div', 'tabs');
  for (const [key, label] of [['month', 'Theo tháng'], ['term', 'Theo khóa']]) {
    const b = h('button', 'tab' + (view.tab === key ? ' is-active' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => { view.tab = key; renderBaoCao(el, ctx); });
    tabs.append(b);
  }
  const body = h('div');
  el.replaceChildren(title, tabs, body);

  try {
    if (view.tab === 'month') await monthTab(body, months, closedMonths, () => renderBaoCao(el, ctx));
    else await termTab(body, terms, () => renderBaoCao(el, ctx));
  } catch (err) {
    body.replaceChildren(callout(err.message, 'error'));
  }
}

async function monthTab(body, months, closedMonths, refresh) {
  const sel = select('month', months.map((m) => [m, monthLabel(m) + (closedMonths.includes(m) ? ' ✓' : '')]), view.month);
  sel.addEventListener('change', () => { view.month = sel.value; refresh(); });
  const pick = h('div', 'card card--panel');
  pick.append(field('Tháng', sel));
  body.replaceChildren(pick, h('p', 'muted', 'Đang tải…'));

  const [inv, classes] = await Promise.all([
    q(db.rpc('month_invoices', { p_month: view.month })),
    q(db.rpc('month_report', { p_month: view.month })),
  ]);
  if (sel.value !== view.month) return;
  const { closed, invoices } = inv;
  const parts = [pick];
  if (!closed) parts.push(callout('Tháng này chưa chốt nên chưa có số liệu hóa đơn. Phần theo lớp tính từ điểm danh hiện có.', 'warning'));

  const sum = (st) => invoices.filter((i) => st.includes(i.status)).reduce((a, i) => a + i.amount, 0);
  const count = (st) => invoices.filter((i) => i.status === st).length;
  parts.push(statCards([
    ['Tổng phải thu', sum(['unpaid', 'reported', 'confirmed']), `${invoices.length} hóa đơn`],
    ['Đã xác nhận', sum(['confirmed']), `${count('confirmed')} em`],
    ['Đã báo, chưa kiểm tra', sum(['reported']), `${count('reported')} em`],
    ['Còn nợ', sum(['unpaid']), `${count('unpaid')} em`],
  ]));

  // Theo lớp: doanh thu tính từ từng buổi có mặt, không chia đều hóa đơn (SPEC A6)
  parts.push(h('h2', 'section__title', 'Theo lớp'));
  if (!classes.length) parts.push(callout('Tháng này chưa có buổi học nào.'));
  else {
    const tot = classes.reduce((a, c) => ({ sessions: a.sessions + c.sessions, present: a.present + c.present, absent: a.absent + c.absent,
      online: a.online + c.online, offline: a.offline + c.offline, revenue: a.revenue + c.revenue }),
      { sessions: 0, present: 0, absent: 0, online: 0, offline: 0, revenue: 0 });
    const heads = [['Lớp'], ['Buổi', 'num'], ['Có mặt', 'num'], ['Vắng', 'num hide-sm'], ['Online', 'num'], ['Offline', 'num'], ['Doanh thu', 'num nowrap']];
    parts.push(table(heads,
      classes.map((c) => [c.name, c.sessions, c.present, c.absent, c.online, c.offline, formatMoney(c.revenue)]),
      ['Tổng', tot.sessions, tot.present, tot.absent, tot.online, tot.offline, formatMoney(tot.revenue)]));
    parts.push(h('p', 'muted small', 'Buổi = số buổi đã dạy. Có mặt, Online, Offline = số lượt có mặt. Doanh thu = tổng học phí các buổi có mặt.'));
  }

  // Danh sách chưa đóng
  const owing = invoices.filter((i) => i.status !== 'confirmed').sort((a, b) => (a.status === b.status ? a.code.localeCompare(b.code) : a.status === 'unpaid' ? -1 : 1));
  parts.push(h('h2', 'section__title', `Chưa đóng (${owing.length})`));
  if (!owing.length) parts.push(callout(closed ? 'Không còn ai nợ.' : 'Chưa có hóa đơn.'));
  else {
    const grid = h('div', 'inv-grid');
    for (const i of owing) {
      const card = h('div', 'inv');
      const top = h('div', 'inv__top');
      const who = h('div', 'inv__who');
      who.append(h('strong', null, i.full_name), h('span', 'muted small', `${i.code} · ${i.classes.join(', ') || 'Không có lớp'}`));
      top.append(who, h('span', STATUS[i.status][1], STATUS[i.status][0]));
      const money = h('div', 'inv__money');
      money.append(h('span', null, `${i.sessions_count} buổi`), h('strong', null, formatMoney(i.amount)));
      card.append(top, money);
      grid.append(card);
    }
    parts.push(grid);
  }

  // Xuất file
  parts.push(h('h2', 'section__title', 'Xuất file (sao lưu)'));
  const box = h('div', 'export-actions');
  const excel = button('Tải Excel (.xlsx)', 'primary', () => busy(excel, null, async () => { await exportXlsx(view.month); toast('Đã tạo file Excel.'); }));
  const csvInv = button('Hóa đơn (CSV)', 'outline', () => busy(csvInv, null, () => exportCsv(view.month, 'invoices')));
  const csvAtt = button('Điểm danh (CSV)', 'outline', () => busy(csvAtt, null, () => exportCsv(view.month, 'attendance')));
  box.append(excel, csvInv, csvAtt);
  parts.push(box, h('p', 'muted small', 'File Excel gồm 2 sheet: Hóa đơn và Điểm danh của tháng đang chọn. Nên tải về cuối mỗi tháng để lưu.'));
  body.replaceChildren(...parts);
}

async function termTab(body, terms, refresh) {
  const sel = select('term', terms.map((t) => [t.id, t.name + (t.is_current ? ' (hiện tại)' : '')]), view.termId);
  sel.addEventListener('change', () => { view.termId = sel.value; refresh(); });
  const pick = h('div', 'card card--panel');
  pick.append(field('Khóa', sel));
  body.replaceChildren(pick, h('p', 'muted', 'Đang tải…'));

  const rows = await q(db.rpc('term_report', { p_term_id: view.termId }));
  if (sel.value !== view.termId) return;
  const parts = [pick];
  if (!rows.length) {
    parts.push(callout('Khóa này chưa có dữ liệu.'));
  } else {
    const tot = rows.reduce((a, r) => ({ total: a.total + r.total, confirmed: a.confirmed + r.confirmed, reported: a.reported + r.reported, unpaid: a.unpaid + r.unpaid,
      sessions: a.sessions + r.sessions, present: a.present + r.present, revenue: a.revenue + r.revenue }),
      { total: 0, confirmed: 0, reported: 0, unpaid: 0, sessions: 0, present: 0, revenue: 0 });
    parts.push(statCards([
      ['Tổng phải thu', tot.total, `${rows.filter((r) => r.closed).length} tháng đã chốt`],
      ['Đã xác nhận', tot.confirmed, ''],
      ['Đã báo, chưa kiểm tra', tot.reported, ''],
      ['Còn nợ', tot.unpaid, ''],
    ]));
    const heads = [['Tháng', 'nowrap'], ['Phải thu', 'num nowrap'], ['Đã xác nhận', 'num nowrap'], ['Đã báo', 'num nowrap'], ['Còn nợ', 'num nowrap'], ['Buổi', 'num'], ['Có mặt', 'num'], ['Doanh thu', 'num nowrap']];
    parts.push(table(heads,
      rows.map((r) => [`${r.month.slice(5)}/${r.month.slice(0, 4)}${r.closed ? '' : ' (chưa chốt)'}`, formatMoney(r.total), formatMoney(r.confirmed), formatMoney(r.reported), formatMoney(r.unpaid), r.sessions, r.present, formatMoney(r.revenue)]),
      ['Tổng', formatMoney(tot.total), formatMoney(tot.confirmed), formatMoney(tot.reported), formatMoney(tot.unpaid), tot.sessions, tot.present, formatMoney(tot.revenue)]));
    parts.push(h('p', 'muted small', 'Tháng chưa chốt chưa có hóa đơn nên các cột tiền hóa đơn bằng 0; cột Doanh thu vẫn tính từ điểm danh.'));
  }
  body.replaceChildren(...parts);
}
