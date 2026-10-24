// P1. Tra cứu của phụ huynh (SPEC 7): không đăng nhập. Chỉ đi qua 2 hàm database lookup_student và report_payment.
import { db } from './db.js';
import { h } from './dom.js';
import { formatMoney, formatDate } from './format.js';
import { bankName, qrUrl } from './banks.js';
import { button, busy, callout, toast, confirmDialog } from './ui.js';

const $ = (id) => document.getElementById(id);
const monthLabel = (m) => `Tháng ${m.slice(5)}/${m.slice(0, 4)}`;
const monthNumber = (m) => String(Number(m.slice(5)));

let lastName = '';   // để tải lại đúng em sau khi bấm "Tôi đã chuyển khoản"

async function lookup(name) {
  const { data, error } = await db.rpc('lookup_student', { p_name: name });
  if (error) throw new Error('Không kết nối được. Kiểm tra mạng rồi thử lại.');
  return data.students;
}

async function search(name, pickCode) {
  const out = $('result');
  out.replaceChildren(h('p', 'muted', 'Đang tra cứu…'));
  let students;
  try {
    students = await lookup(name);
  } catch (err) {
    out.replaceChildren(callout(err.message, 'error'));
    return;
  }
  lastName = name;
  if (!students.length) {
    out.replaceChildren(callout('Không tìm thấy học sinh. Vui lòng kiểm tra lại họ tên đầy đủ có dấu hoặc liên hệ cô.', 'warning'));
    return;
  }
  const picked = pickCode ? students.find((s) => s.code === pickCode) : (students.length === 1 ? students[0] : null);
  if (picked) { renderStudent(out, picked); return; }

  // Trùng tên: cho phụ huynh chọn theo mã HS và lớp
  const box = h('div');
  box.append(callout(`Có ${students.length} học sinh trùng tên. Chọn đúng con của bạn:`));
  const list = h('div', 'list');
  for (const s of students) {
    const item = h('button', 'pick-item');
    item.type = 'button';
    item.append(h('strong', null, s.full_name), h('span', 'muted small', `Mã ${s.code} · ${s.classes.join(', ') || 'chưa có lớp'}`));
    item.addEventListener('click', () => renderStudent(out, s));
    list.append(item);
  }
  box.append(list);
  out.replaceChildren(box);
}

function renderStudent(out, s) {
  const parts = [];
  const head = h('div', 'card card--panel');
  head.append(
    h('h2', 'card__title', s.full_name),
    h('p', null, `Mã học sinh: `),
    h('p', 'muted small', 'Mã này sẽ nằm cuối nội dung chuyển khoản.'),
    h('p', 'muted small', s.classes.length ? `Lớp đang học: ${s.classes.join(', ')}` : 'Hiện chưa ghi danh lớp nào.'),
  );
  head.children[1].append(h('strong', 'code-big', s.code));
  parts.push(head);

  if (!s.invoices.length) {
    parts.push(callout('Hiện chưa có học phí cần đóng. Học phí được chốt vào cuối mỗi tháng.'));
  }
  const unpaidOlder = s.invoices.filter((i, idx) => idx > 0 && i.status === 'unpaid').length;
  if (unpaidOlder) parts.push(callout('Còn tháng cũ chưa đóng, xem các khung bên dưới. Nếu đã chuyển khoản, bấm “Tôi đã chuyển khoản” ở đúng tháng đó.', 'warning'));
  for (const inv of s.invoices) parts.push(invoiceCard(s, inv));
  out.replaceChildren(...parts);
}

function invoiceCard(s, inv) {
  const card = h('div', 'card month-card');
  const top = h('div', 'inv__top');
  top.append(h('h3', 'card__title', `Học phí ${monthLabel(inv.month).toLowerCase()}`));
  const label = { unpaid: ['Chưa đóng', 'pill pill--warning'], reported: ['Đã báo chuyển', 'pill pill--primary'], confirmed: ['Đã đóng ✓', 'pill pill--success'] }[inv.status];
  top.append(h('span', label[1], label[0]));
  card.append(top);

  card.append(h('p', null, `Số buổi có mặt: ${inv.sessions_count}`));
  if (inv.present.length) {
    const dates = h('p', 'muted small');
    dates.textContent = inv.present.map((p) => `${formatDate(p.date).slice(0, 5)}`).join(', ');
    card.append(dates);
  }
  const money = h('div', 'inv__money');
  money.append(h('span', null, 'Số tiền'), h('strong', 'amount-big', formatMoney(inv.amount)));
  card.append(money);

  if (inv.status === 'confirmed') { card.append(h('p', 'pill pill--success block', 'Đã đóng ✓ Cảm ơn phụ huynh.')); return card; }
  if (inv.amount === 0 || !inv.bank) { card.append(callout('Tháng này không có khoản cần chuyển.')); return card; }

  // QR + nội dung chuyển khoản (chỉ khi chưa đóng hoặc đã báo, SPEC 6.4)
  const url = qrUrl(inv.bank, inv.amount, inv.transfer_note);
  const qr = h('div', 'qr-box');
  const img = h('img', 'qr-preview__img');
  img.alt = `Mã QR chuyển khoản học phí ${monthLabel(inv.month)}`;
  img.src = url;
  qr.append(img);
  card.append(qr);

  const info = h('div', 'pay-info');
  const row = (k, v, copy) => {
    const r = h('div', 'pay-row');
    r.append(h('span', 'muted small', k), h('strong', 'pay-val', v));
    if (copy) r.append(button('Sao chép', 'outline btn--sm', () => copyText(copy)));
    info.append(r);
  };
  row('Ngân hàng', bankName(inv.bank.bank_bin));
  row('Số tài khoản', inv.bank.account_no, inv.bank.account_no);
  row('Chủ tài khoản', inv.bank.account_name);
  row('Số tiền', formatMoney(inv.amount), String(inv.amount));
  row('Nội dung', inv.transfer_note, inv.transfer_note);
  card.append(info);
  card.append(h('p', 'muted small', 'Quét mã QR bằng app ngân hàng (hoặc bấm giữ vào ảnh để lưu về máy). Giữ nguyên nội dung chuyển khoản để cô đối soát đúng.'));

  const actions = h('div', 'pay-actions');
  actions.append(button('Tải mã QR', 'outline', () => downloadQr(url, `hoc-phi-${s.code}-T${monthNumber(inv.month)}.png`)));
  if (inv.status === 'unpaid') {
    const done = button('Tôi đã chuyển khoản', 'primary', async () => {
      const ok = await confirmDialog('Xác nhận đã chuyển khoản',
        `Bạn đã chuyển ${formatMoney(inv.amount)} cho học phí ${monthLabel(inv.month).toLowerCase()} của ${s.full_name}?\n\nCô sẽ kiểm tra sao kê và xác nhận.`, 'Tôi đã chuyển');
      if (!ok) return;
      busy(done, null, async () => {
        const { data, error } = await db.rpc('report_payment', { p_code: s.code, p_month: inv.month });
        if (error) throw new Error('Không gửi được. Kiểm tra mạng rồi thử lại.');
        if (data !== 'reported' && data !== 'confirmed') throw new Error('Không ghi nhận được. Vui lòng liên hệ cô.');
        toast('Đã ghi nhận, cô sẽ kiểm tra và xác nhận.');
        search(lastName, s.code);
      });
    });
    actions.append(done);
  } else {
    card.append(callout('Đã ghi nhận, cô sẽ kiểm tra và xác nhận.', 'info'));
  }
  card.append(actions);
  return card;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = h('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.append(t);
    t.select();
    try { document.execCommand('copy'); } catch { /* bỏ qua */ }
    t.remove();
  }
  toast('Đã sao chép.');
}

// Tải ảnh QR về máy; nếu trình duyệt không cho tải thì mở ảnh ở tab mới để bấm giữ lưu
async function downloadQr(url, filename) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('http');
    const blob = await res.blob();
    const a = h('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch {
    window.open(url, '_blank', 'noopener');
    toast('Ảnh đã mở ở tab mới: bấm giữ ảnh để lưu.');
  }
}

$('lookup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('student-name').value.trim().replace(/\s+/g, ' ');
  const btn = e.currentTarget.querySelector('button[type=submit]');
  if (name.split(' ').length < 2) {
    $('result').replaceChildren(callout('Nhập đầy đủ họ và tên của con (ít nhất 2 từ).', 'warning'));
    return;
  }
  btn.disabled = true;
  try { await search(name); } finally { btn.disabled = false; }
});
