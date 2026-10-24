// Mã BIN ngân hàng theo danh sách công khai của VietQR (api.vietqr.io/v2/banks). Dùng chung cho Cài đặt và trang tra cứu.
export const BANKS = [
  ['970415', 'VietinBank'], ['970436', 'Vietcombank'], ['970418', 'BIDV'], ['970405', 'Agribank'],
  ['970407', 'Techcombank'], ['970422', 'MBBank'], ['970416', 'ACB'], ['970432', 'VPBank'],
  ['970423', 'TPBank'], ['970403', 'Sacombank'], ['970437', 'HDBank'], ['970441', 'VIB'],
  ['970443', 'SHB'], ['970448', 'OCB'], ['970426', 'MSB'], ['970440', 'SeABank'],
  ['970431', 'Eximbank'], ['970449', 'LPBank'], ['970428', 'NamABank'], ['970409', 'BacABank'],
];

export const bankName = (bin) => BANKS.find(([b]) => b === bin)?.[1] ?? `Ngân hàng (BIN ${bin})`;

// Ảnh QR VietQR (SPEC 6.4); sinh ở trình duyệt, không lưu file
export function qrUrl({ bank_bin, account_no, account_name }, amount, note) {
  return `https://img.vietqr.io/image/${bank_bin}-${account_no}-compact2.png?amount=${amount}`
    + `&addInfo=${encodeURIComponent(note)}&accountName=${encodeURIComponent(account_name)}`;
}
