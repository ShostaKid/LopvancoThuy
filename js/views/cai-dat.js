// A7. Cài đặt (SPEC 7): tài khoản nhận tiền (VietQR) và giá mặc định. Chỉ Admin sửa, co-admin chỉ xem.
import { db } from '../db.js';
import { h } from '../dom.js';
import { q } from '../data.js';
import { formatMoney } from '../format.js';
import { button, busy, field, input, select, callout, toast } from '../ui.js';

// Mã BIN theo danh sách công khai của VietQR (api.vietqr.io/v2/banks)
const BANKS = [
  ['970415', 'VietinBank'], ['970436', 'Vietcombank'], ['970418', 'BIDV'], ['970405', 'Agribank'],
  ['970407', 'Techcombank'], ['970422', 'MBBank'], ['970416', 'ACB'], ['970432', 'VPBank'],
  ['970423', 'TPBank'], ['970403', 'Sacombank'], ['970437', 'HDBank'], ['970441', 'VIB'],
  ['970443', 'SHB'], ['970448', 'OCB'], ['970426', 'MSB'], ['970440', 'SeABank'],
  ['970431', 'Eximbank'], ['970449', 'LPBank'], ['970428', 'NamABank'], ['970409', 'BacABank'],
];
const OTHER = 'other';

// Tên chủ tài khoản VietQR: chữ hoa không dấu
const toAccountName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();

export async function renderCaiDat(el, ctx) {
  const title = h('h1', 'page-title', 'Cài đặt');
  el.replaceChildren(title, h('p', 'muted', 'Đang tải…'));

  let row;
  try {
    row = (await q(db.from('settings').select('id, bank_bin, account_no, account_name, default_fee').limit(1)))[0];
  } catch (err) {
    el.replaceChildren(title, callout(err.message, 'error'));
    return;
  }
  if (!row) { el.replaceChildren(title, callout('Chưa có dòng cài đặt trong database.', 'error')); return; }

  const editable = ctx.can('settings.edit');
  const known = BANKS.some(([bin]) => bin === row.bank_bin);
  const bank = select('bank', [...BANKS.map(([bin, name]) => [bin, name]), [OTHER, 'Ngân hàng khác (nhập mã BIN)']], known ? row.bank_bin : OTHER);
  const bin = input('text', 'bin', row.bank_bin);
  bin.inputMode = 'numeric';
  bin.placeholder = '6 chữ số, VD 970415';
  const binField = field('Mã BIN ngân hàng', bin, 'Tra ở https://api.vietqr.io/v2/banks');
  binField.hidden = known;
  const account = input('text', 'account', row.account_no);
  account.inputMode = 'numeric';
  const name = input('text', 'name', row.account_name);
  name.autocapitalize = 'characters';
  const fee = input('number', 'fee', String(row.default_fee));
  fee.min = '0';
  fee.step = '1000';
  fee.inputMode = 'numeric';

  const preview = h('div', 'qr-preview');
  const currentBin = () => (bank.value === OTHER ? bin.value.trim() : bank.value);
  function drawPreview() {
    const b = currentBin();
    const a = account.value.trim();
    if (!/^\d{6}$/.test(b) || !/^\d{6,19}$/.test(a) || !name.value.trim()) {
      preview.replaceChildren(h('p', 'muted small', 'Điền đủ ngân hàng, số tài khoản và tên để xem thử mã QR.'));
      return;
    }
    const img = h('img', 'qr-preview__img');
    img.alt = 'Mã QR thử';
    img.src = `https://img.vietqr.io/image/${b}-${a}-compact2.png?amount=${Number(fee.value) || 0}&addInfo=${encodeURIComponent('THU NGHIEM')}&accountName=${encodeURIComponent(toAccountName(name.value))}`;
    preview.replaceChildren(h('p', 'muted small', `Mã QR thử (${formatMoney(Number(fee.value) || 0)}, nội dung “THU NGHIEM”). Quét bằng app ngân hàng để kiểm tra đúng tài khoản, đừng chuyển tiền.`), img);
  }

  bank.addEventListener('change', () => { binField.hidden = bank.value !== OTHER; drawPreview(); });
  for (const i of [bin, account, name, fee]) i.addEventListener('change', drawPreview);
  name.addEventListener('input', () => { name.value = name.value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toUpperCase(); });

  const card = h('div', 'card');
  card.append(
    h('h2', 'card__title', 'Tài khoản nhận học phí'),
    field('Ngân hàng', bank), binField,
    field('Số tài khoản', account),
    field('Tên chủ tài khoản', name, 'Chữ hoa không dấu, đúng như ngân hàng ghi.'),
    h('h2', 'card__title', 'Học phí'),
    field('Giá mặc định mỗi buổi (đồng)', fee, 'Chỉ áp dụng cho các buổi điểm danh từ nay trở đi. Buổi đã điểm danh giữ giá cũ.'),
  );

  const error = h('p', 'form-error');
  const save = button('Lưu cài đặt', 'primary', () => busy(save, error, async () => {
    const patch = {
      bank_bin: currentBin(),
      account_no: account.value.trim(),
      account_name: toAccountName(name.value),
      default_fee: Number(fee.value),
    };
    if (!/^\d{6}$/.test(patch.bank_bin)) throw new Error('Mã BIN ngân hàng phải gồm 6 chữ số.');
    if (!/^\d{6,19}$/.test(patch.account_no)) throw new Error('Số tài khoản chỉ gồm chữ số (6 đến 19 số).');
    if (!patch.account_name) throw new Error('Nhập tên chủ tài khoản.');
    if (!Number.isInteger(patch.default_fee) || patch.default_fee < 0) throw new Error('Giá mỗi buổi phải là số nguyên không âm.');
    const done = await q(db.from('settings').update(patch).eq('id', row.id).select('id'));
    if (!done.length) throw new Error('Không lưu được. Chỉ Admin sửa được cài đặt.');
    toast('Đã lưu cài đặt.');
    renderCaiDat(el, ctx);
  }));

  if (editable) card.append(error, save);
  else {
    card.querySelectorAll('input, select').forEach((c) => { c.disabled = true; });
    card.append(callout('Chỉ Admin sửa được cài đặt. Bạn đang ở chế độ xem.'));
  }
  el.replaceChildren(title, card, h('h2', 'section__title', 'Xem thử mã QR'), preview);
  drawPreview();
}
