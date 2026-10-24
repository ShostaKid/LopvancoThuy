-- 007_month_close.sql — Bước 5: chốt tháng, mở lại tháng, danh sách hóa đơn tháng (SPEC.md 6.2, 6.3, 7 A5)
-- Cả 3 hàm là SECURITY INVOKER: vẫn đi qua RLS. Chốt / mở lại chỉ Admin (kiểm tra thêm để báo lỗi rõ ràng).

-- Nội dung chuyển khoản (SPEC 6.2): <TÊN KHÔNG DẤU VIẾT HOA> HOC PHI T<tháng> <MÃ HS>, tối đa 50 ký tự.
-- Quá dài thì cắt phần tên, không bao giờ cắt "HOC PHI T.." và mã HS. Chỉ gồm A–Z, 0–9, dấu cách.
create or replace function public.make_transfer_note(p_name_search text, p_month text, p_code text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_suffix text := ' HOC PHI T' || (substr(p_month, 6, 2))::int::text || ' ' || upper(p_code);
  v_name text := btrim(regexp_replace(regexp_replace(upper(p_name_search), '[^A-Z0-9 ]', '', 'g'), ' +', ' ', 'g'));
begin
  v_name := btrim(left(v_name, greatest(0, 50 - length(v_suffix))));
  return btrim(v_name || v_suffix);
end;
$$;

-- Chốt tháng. Trả về { created, updated, deleted, warnings: [...] }.
create or replace function public.close_month(p_month text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_start date;
  v_end date;
  v_created int := 0;
  v_updated int := 0;
  v_deleted int := 0;
  v_warn jsonb := '[]'::jsonb;
  r record;
  v_inv public.invoices;
begin
  if not public.is_admin() then
    raise exception 'Chỉ Admin được chốt tháng.';
  end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Tháng không hợp lệ.';
  end if;
  if p_month > to_char(public.vn_today(), 'YYYY-MM') then
    raise exception 'Chưa chốt được tháng chưa tới.';
  end if;
  if exists (select 1 from public.month_closings where month = p_month) then
    raise exception 'Tháng % đã chốt rồi.', p_month;
  end if;

  v_start := (p_month || '-01')::date;
  v_end := (v_start + interval '1 month')::date;

  insert into public.month_closings (month) values (p_month);

  -- Mỗi em có ít nhất 1 buổi có mặt trong tháng → 1 hóa đơn gộp mọi lớp
  for r in
    select s.id, s.code, s.full_name, s.name_search,
           count(*)::int as n, coalesce(sum(se.fee), 0)::int as amt
    from public.attendance a
    join public.sessions se on se.id = a.session_id and se.date >= v_start and se.date < v_end
    join public.students s on s.id = a.student_id
    where a.present
    group by s.id, s.code, s.full_name, s.name_search
  loop
    select * into v_inv from public.invoices where student_id = r.id and month = p_month;
    if not found then
      insert into public.invoices (student_id, month, sessions_count, amount, transfer_note)
      values (r.id, p_month, r.n, r.amt, public.make_transfer_note(r.name_search, p_month, r.code));
      v_created := v_created + 1;
    elsif v_inv.status = 'confirmed' then
      if v_inv.sessions_count <> r.n then
        v_warn := v_warn || jsonb_build_object('type', 'confirmed_changed', 'code', r.code, 'name', r.full_name,
                                               'old_count', v_inv.sessions_count, 'new_count', r.n);
      end if;
    else
      update public.invoices
         set sessions_count = r.n, amount = r.amt,
             transfer_note = public.make_transfer_note(r.name_search, p_month, r.code)
       where id = v_inv.id;
      v_updated := v_updated + 1;
      if v_inv.status = 'reported' and r.amt is distinct from v_inv.reported_amount then
        v_warn := v_warn || jsonb_build_object('type', 'reported_changed', 'code', r.code, 'name', r.full_name,
                                               'reported_amount', v_inv.reported_amount, 'new_amount', r.amt);
      end if;
    end if;
  end loop;

  -- Hóa đơn cũ của em nay không còn buổi nào: chưa đóng thì xóa; đã báo / đã xác nhận thì giữ và cảnh báo
  for r in
    select i.id, i.status, s.code, s.full_name
    from public.invoices i
    join public.students s on s.id = i.student_id
    where i.month = p_month
      and not exists (
        select 1 from public.attendance a
        join public.sessions se on se.id = a.session_id and se.date >= v_start and se.date < v_end
        where a.student_id = i.student_id and a.present)
  loop
    if r.status = 'unpaid' then
      delete from public.invoices where id = r.id;
      v_deleted := v_deleted + 1;
    else
      if r.status = 'reported' then
        update public.invoices set sessions_count = 0, amount = 0 where id = r.id;
      end if;
      v_warn := v_warn || jsonb_build_object('type', 'zero_kept', 'code', r.code, 'name', r.full_name, 'status', r.status);
    end if;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'deleted', v_deleted, 'warnings', v_warn);
end;
$$;

-- Mở lại tháng: gỡ khóa để sửa điểm danh. Hóa đơn giữ nguyên, tính lại khi chốt lại.
create or replace function public.reopen_month(p_month text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Chỉ Admin được mở lại tháng.';
  end if;
  delete from public.month_closings where month = p_month;
  if not found then
    raise exception 'Tháng % chưa được chốt.', p_month;
  end if;
end;
$$;

-- Hóa đơn của 1 tháng kèm tên các lớp em đã học trong tháng, và tháng đã chốt hay chưa
create or replace function public.month_invoices(p_month text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'closed', exists (select 1 from public.month_closings where month = p_month),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'student_id', i.student_id, 'code', s.code, 'full_name', s.full_name,
        'sessions_count', i.sessions_count, 'amount', i.amount, 'transfer_note', i.transfer_note,
        'status', i.status, 'reported_at', i.reported_at, 'reported_amount', i.reported_amount,
        'confirmed_at', i.confirmed_at,
        'classes', coalesce((
          select jsonb_agg(x.name order by x.name)
          from (select distinct c.name
                from public.attendance a
                join public.sessions se on se.id = a.session_id
                  and to_char(se.date, 'YYYY-MM') = p_month
                join public.classes c on c.id = se.class_id
                where a.student_id = i.student_id and a.present) x
        ), '[]'::jsonb)
      ) order by s.code)
      from public.invoices i
      join public.students s on s.id = i.student_id
      where i.month = p_month
    ), '[]'::jsonb));
$$;

revoke execute on function public.make_transfer_note(text, text, text), public.close_month(text),
  public.reopen_month(text), public.month_invoices(text) from public, anon;
grant execute on function public.make_transfer_note(text, text, text), public.close_month(text),
  public.reopen_month(text), public.month_invoices(text) to authenticated;
