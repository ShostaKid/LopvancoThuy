// A5. Học phí tháng (SPEC 7): chốt / mở lại tháng, bảng hóa đơn, xác nhận đã nhận tiền
import { db } from '../db.js';
import { h } from '../dom.js';
import { q, loadTerms } from '../data.js';
import { formatMoney, formatDate, vnToday } from '../format.js';
import { openDialog, button, busy, field, select, callout, toast, confirmDialog } from '../ui.js';

const STATUS = {
  unpaid: ['Chưa đóng', 'pill pill--warning'],
  reported: ['Đã báo chuyển', 'pill pill--primary'],
  confirmed: ['Đã đóng', 'pill pill--success'],
};
const STATUS_ORDER = { reported: 0, unpaid: 1, confirmed: 2 };   // đã báo chuyển lên đầu (SPEC 7 A5)

const view = { month: null, status: 'all' };   // giữ lựa chọn khi chuyển màn hình

// Các tháng từ đầu khóa hiện tại tới tháng này, mới nhất trước, cộng mọi tháng đã chốt
function monthChoices(term, closed) {
  const now = vnToday().slice(0, 7);
  const set = new Set(closed);
  if (term) {
    let [y, m] = term.start_date.slice(0, 7).split('-').map(Number);
    for (;;) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (key > now) break;
      set.add(key);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  } else set.add(now);
  return [...set].sort().reverse();
}

const monthLabel = (m) => `Tháng ${m.slice(5)}/${m.slice(0, 4)}`;

export async function renderHocPhi(el, ctx) {
  const title = h('h1', 'page-title', 'Học phí');
  el.replaceChildren(title, h('p', 'muted', 'Đang tải…'));

  let terms, closings;
  try {
    [terms, closings] = await Promise.all([loadTerms(), q(db.from('month_closings').select('month'))]);
  } catch (err) {
    el.replaceChildren(title, callout(err.message, 'error'));
    return;
  }
  const closedMonths = closings.map((c) => c.month);
  const months = monthChoices(terms.find((t) => t.is_current), closedMonths);
  if (!months.includes(view.month)) view.month = vnToday().slice(0, 7);
  if (!months.includes(view.month)) view.month = months[0];

  const refresh = () => renderHocPhi(el, ctx);
  const monthSel = select('month', months.map((m) => [m, monthLabel(m) + (closedMonths.includes(m) ? ' ✓' : '')]), view.month);
  monthSel.addEventListener('change', () => { view.month = monthSel.value; refresh(); });
  const pick = h('div', 'card card--panel');
  pick.append(field('Tháng', monthSel));
  const body = h('div');
  el.replaceChildren(title, pick, body);

  let data;
  try {
    data = await q(db.rpc('month_invoices', { p_month: view.month }));
  } catch (err) {
    body.replaceChildren(callout(err.message, 'error'));
    return;
  }
  if (monthSel.value !== view.month) return;   // đã đổi tháng trong lúc chờ

  const { closed, invoices } = data;
  const parts = [];

  // ---- Trạng thái tháng + nút chốt / mở lại ----
  const bar = h('div', 'section__head');
  const statusBox = h('div');
  if (closed) statusBox.append(h('span', 'pill pill--success', 'Đã chốt'), h('span', 'muted small', '  Điểm danh tháng này đang khóa.'));
  else if (invoices.length) statusBox.append(h('span', 'pill pill--warning', 'Đang mở lại'), h('span', 'muted small', '  Hóa đơn bên dưới sẽ tính lại khi chốt.'));
  else statusBox.append(h('span', 'pill pill--muted', 'Chưa chốt'));
  bar.append(statusBox);
  if (ctx.can('month.close')) {
    bar.append(closed
      ? button('Mở lại tháng', 'outline', () => reopen(invoices))
      : button('Chốt tháng', 'primary', () => closeDialog()));
  } else {
    bar.append(h('span', 'muted small', 'Chỉ Admin chốt / mở lại tháng.'));
  }
  parts.push(bar);

  if (!invoices.length) {
    parts.push(callout(closed
      ? 'Tháng này đã chốt nhưng không có em nào có mặt buổi nào, nên không có hóa đơn.'
      : 'Chưa có hóa đơn. Bấm “Chốt tháng” để tạo hóa đơn cho mọi em có mặt ít nhất 1 buổi trong tháng.'));
    body.replaceChildren(...parts);
    return;
  }

  // ---- Tổng hợp ----
  const sum = (st) => invoices.filter((i) => st.includes(i.status)).reduce((a, i) => a + i.amount, 0);
  const cards = h('div', 'stats');
  for (const [label, value, note] of [
    ['Phải thu', sum(['unpaid', 'reported', 'confirmed']), `${invoices.length} em`],
    ['Đã xác nhận', sum(['confirmed']), `${invoices.filter((i) => i.status === 'confirmed').length} em`],
    ['Đã báo, chưa kiểm tra', sum(['reported']), `${invoices.filter((i) => i.status === 'reported').length} em`],
    ['Chưa đóng', sum(['unpaid']), `${invoices.filter((i) => i.status === 'unpaid').length} em`],
  ]) {
    const c = h('div', 'stat');
    c.append(h('span', 'stat__label', label), h('strong', 'stat__value', formatMoney(value)), h('span', 'muted small', note));
    cards.append(c);
  }
  parts.push(cards);

  // ---- Bộ lọc + bảng ----
  const statusSel = select('status', [['all', 'Mọi trạng thái'], ['reported', 'Đã báo chuyển'], ['unpaid', 'Chưa đóng'], ['confirmed', 'Đã đóng']], view.status);
  const listBox = h('div');
  statusSel.addEventListener('change', () => { view.status = statusSel.value; renderTable(); });
  const filterBox = h('div', 'toolbar toolbar--one');
  filterBox.append(field('Lọc theo trạng thái', statusSel));
  parts.push(filterBox, listBox);
  body.replaceChildren(...parts);
  renderTable();

  function renderTable() {
    const rows = invoices
      .filter((i) => view.status === 'all' || i.status === view.status)
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.code.localeCompare(b.code));
    if (!rows.length) { listBox.replaceChildren(callout('Không có hóa đơn nào khớp bộ lọc.')); return; }

    // Mỗi hóa đơn là 1 thẻ: đọc được trên điện thoại, nút thao tác không bị đẩy ra ngoài màn hình
    const grid = h('div', 'inv-grid');
    for (const i of rows) {
      const [label, cls] = STATUS[i.status];
      const card = h('div', 'inv');
      const top = h('div', 'inv__top');
      const who = h('div', 'inv__who');
      who.append(h('strong', null, i.full_name), h('span', 'muted small', `${i.code} · ${i.classes.join(', ') || 'Không có lớp'}`));
      top.append(who, h('span', cls, label));
      const money = h('div', 'inv__money');
      money.append(h('span', null, `${i.sessions_count} buổi`), h('strong', null, formatMoney(i.amount)));
      card.append(top, money, h('div', 'small muted code', i.transfer_note), h('div', 'small muted', `Nhận vào: ${i.bank_label ?? 'chưa gán tài khoản'}`));
      for (const w of warningsOf(i)) card.append(h('div', 'small text-warning', w));
      if (closed) {
        const box = h('div', 'row-actions');
        if (i.status === 'confirmed') box.append(button('Hoàn tác', 'outline btn--sm', () => setStatus(i, i.reported_at ? 'reported' : 'unpaid')));
        else box.append(button('Xác nhận đã nhận', 'primary btn--sm', () => setStatus(i, 'confirmed')));
        if (i.status === 'reported') box.append(button('Về chưa đóng', 'outline btn--sm', () => setStatus(i, 'unpaid')));
        card.append(box);
      }
      grid.append(card);
    }
    listBox.replaceChildren(h('p', 'muted small', `${rows.length} hóa đơn${closed ? '' : ' (tháng đang mở lại, chưa xác nhận được tiền)'}`), grid);
  }

  // Cảnh báo tính được ngay từ dữ liệu (SPEC 6.3)
  function warningsOf(i) {
    const w = [];
    if (i.status === 'reported' && i.reported_amount != null && i.reported_amount !== i.amount) {
      w.push(`Số tiền đã đổi: phụ huynh báo chuyển ${formatMoney(i.reported_amount)}, hiện tính ${formatMoney(i.amount)}. Đối chiếu sao kê.`);
    }
    if (i.sessions_count === 0 && i.status !== 'unpaid') w.push('Em này không còn buổi nào nhưng hóa đơn đã báo / đã xác nhận. Cần xử lý (VD trả lại tiền).');
    return w;
  }

  async function setStatus(inv, status) {
    const patch = status === 'confirmed'
      ? { status, confirmed_at: new Date().toISOString(), confirmed_by: ctx.staff.userId }
      : { status, confirmed_at: null, confirmed_by: null, ...(status === 'unpaid' ? { reported_at: null, reported_amount: null } : {}) };
    try {
      const done = await q(db.from('invoices').update(patch).eq('id', inv.id).select('id'));
      if (!done.length) throw new Error('Không cập nhật được hóa đơn.');
      toast(status === 'confirmed' ? `Đã xác nhận ${inv.full_name}.` : `Đã cập nhật ${inv.full_name}.`);
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---- Chốt tháng ----
  function closeDialog() {
    const d = openDialog(`Chốt ${monthLabel(view.month).toLowerCase()}`);
    const notEnded = view.month === vnToday().slice(0, 7);
    d.body.append(h('p', null, 'Hệ thống sẽ tạo hóa đơn cho mọi em có mặt ít nhất 1 buổi trong tháng, gộp mọi lớp thành 1 hóa đơn. Em không có buổi nào thì không có hóa đơn.'));
    d.body.append(callout('Sau khi chốt, điểm danh các buổi trong tháng bị khóa. Muốn sửa phải mở lại tháng.', 'warning'));
    if (notEnded) d.body.append(callout('Tháng này chưa hết. Chốt bây giờ sẽ khóa điểm danh cả những ngày chưa tới.', 'error'));
    const go = button('Chốt tháng', 'primary', () => busy(go, d.error, async () => {
      const res = await q(db.rpc('close_month', { p_month: view.month }));
      d.close();
      resultDialog(res);
      refresh();
    }));
    d.footer.append(button('Hủy', 'outline', d.close), go);
  }

  function resultDialog(res) {
    const d = openDialog('Đã chốt tháng');
    d.body.append(h('p', null, `Tạo mới ${res.created} hóa đơn, tính lại ${res.updated}, xóa ${res.deleted}.`));
    if (res.warnings.length) {
      d.body.append(h('p', null, 'Cần xem lại:'));
      const ul = h('ul', 'warn-list');
      for (const w of res.warnings) {
        const who = `${w.code} ${w.name}`;
        const text = {
          confirmed_changed: `${who}: hóa đơn đã xác nhận giữ nguyên ${w.old_count} buổi, nhưng điểm danh hiện có ${w.new_count} buổi.`,
          reported_changed: `${who}: phụ huynh báo chuyển ${formatMoney(w.reported_amount)}, nhưng hiện tính ${formatMoney(w.new_amount)}.`,
          zero_kept: `${who}: không còn buổi nào nhưng hóa đơn đã ${w.status === 'confirmed' ? 'xác nhận' : 'báo chuyển'}, đã giữ lại.`,
          multi_account: `${who}: học nhiều lớp dùng các tài khoản nhận tiền khác nhau. Hóa đơn dùng tài khoản của lớp em học nhiều buổi nhất.`,
        }[w.type];
        ul.append(h('li', null, text));
      }
      d.body.append(ul);
    }
    d.footer.append(button('Đóng', 'primary', d.close));
  }

  // ---- Mở lại tháng ----
  async function reopen(list) {
    const paid = list.filter((i) => i.status !== 'unpaid').length;
    const msg = `Mở lại ${monthLabel(view.month).toLowerCase()}?\n\n- Điểm danh tháng này sửa được trở lại.\n- Phụ huynh tạm thời không thấy hóa đơn tháng này.\n- Khi chốt lại, hóa đơn chưa xác nhận sẽ được tính lại.`
      + (paid ? `\n- Đang có ${paid} hóa đơn đã báo chuyển hoặc đã xác nhận: sẽ được giữ lại, nhớ đối chiếu sau khi chốt lại.` : '');
    if (!(await confirmDialog('Mở lại tháng', msg, 'Mở lại tháng'))) return;
    try {
      await q(db.rpc('reopen_month', { p_month: view.month }));
      toast(`Đã mở lại ${monthLabel(view.month).toLowerCase()}.`);
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}
