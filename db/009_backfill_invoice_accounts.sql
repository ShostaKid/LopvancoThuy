-- 009_backfill_invoice_accounts.sql — Gán tài khoản nhận tiền cho các hóa đơn tạo trước khi có 008.
-- Lúc chạy chỉ có 1 tài khoản nên gán thẳng tài khoản đó. Hóa đơn tạo sau 008 đã có tài khoản từ close_month.
update public.invoices
   set bank_account_id = (select id from public.bank_accounts order by created_at limit 1)
 where bank_account_id is null;
