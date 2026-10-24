-- 008_bank_accounts.sql — Tài khoản nhận học phí theo từng lớp; chặn điểm danh em chưa ghi danh lớp
-- Thay mục 4.9 cũ (1 tài khoản duy nhất trong settings). Hóa đơn gộp của em học nhiều lớp dùng tài khoản
-- của lớp em có mặt nhiều buổi nhất trong tháng (hòa thì lấy lớp có tên đứng trước); close_month cảnh báo trường hợp này.

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null check (btrim(label) <> ''),
  bank_bin text not null check (bank_bin ~ '^[0-9]{6}$'),
  account_no text not null check (account_no ~ '^[0-9]{6,19}$'),
  account_name text not null check (btrim(account_name) <> ''),
  created_at timestamptz not null default now()
);
alter table public.bank_accounts enable row level security;
create policy staff_select on public.bank_accounts for select to authenticated using ((select public.is_staff()));
create policy admin_insert on public.bank_accounts for insert to authenticated with check ((select public.is_admin()));
create policy admin_update on public.bank_accounts for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy admin_delete on public.bank_accounts for delete to authenticated using ((select public.is_admin()));
revoke all on public.bank_accounts from anon;
grant select, insert, update, delete on public.bank_accounts to authenticated;

-- Chuyển tài khoản đang có trong settings sang bảng mới
insert into public.bank_accounts (label, bank_bin, account_no, account_name)
select 'Tài khoản chính', bank_bin, account_no, account_name from public.settings where account_no <> '';

alter table public.classes add column bank_account_id uuid references public.bank_accounts (id) on delete restrict;
update public.classes set bank_account_id = (select id from public.bank_accounts order by created_at limit 1);
alter table public.classes alter column bank_account_id set not null;

alter table public.invoices add column bank_account_id uuid references public.bank_accounts (id) on delete restrict;

-- Tra cứu của phụ huynh: mỗi hóa đơn kèm tài khoản nhận tiền của nó
create or replace function public.lookup_student(p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := public.normalize_name(p_name);
  v_latest text;
  v_students jsonb;
begin
  if coalesce(array_length(string_to_array(v_key, ' '), 1), 0) < 2 then
    return jsonb_build_object('students', '[]'::jsonb);
  end if;

  select max(month) into v_latest from public.month_closings;

  select coalesce(jsonb_agg(jsonb_build_object(
      'code', s.code,
      'full_name', s.full_name,
      'classes', coalesce((
        select jsonb_agg(c.name order by c.name)
        from public.enrollments e
        join public.classes c on c.id = e.class_id
        join public.terms t on t.id = e.term_id and t.is_current
        where e.student_id = s.id
          and (e.left_on is null or e.left_on > public.vn_today())
      ), '[]'::jsonb),
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
            'month', i.month,
            'sessions_count', i.sessions_count,
            'amount', i.amount,
            'status', i.status,
            'transfer_note', i.transfer_note,
            'bank', (select jsonb_build_object('bank_bin', b.bank_bin, 'account_no', b.account_no, 'account_name', b.account_name)
                     from public.bank_accounts b where b.id = i.bank_account_id),
            'present', coalesce((
              select jsonb_agg(jsonb_build_object('date', se.date, 'class', c2.name) order by se.date, c2.name)
              from public.attendance a
              join public.sessions se on se.id = a.session_id
              join public.classes c2 on c2.id = se.class_id
              where a.student_id = s.id
                and a.present
                and to_char(se.date, 'YYYY-MM') = i.month
            ), '[]'::jsonb)
          ) order by i.month desc)
        from public.invoices i
        join public.month_closings mc on mc.month = i.month
        where i.student_id = s.id
          and (i.month = v_latest or i.status <> 'confirmed')
      ), '[]'::jsonb)
    ) order by s.code), '[]'::jsonb)
  into v_students
  from public.students s
  where s.name_search = v_key;

  return jsonb_build_object('students', v_students);
end;
$$;

-- settings chỉ còn giá mặc định
alter table public.settings drop column bank_bin, drop column account_no, drop column account_name;

-- Chốt tháng: thêm tài khoản nhận tiền cho hóa đơn, cảnh báo em học nhiều lớp khác tài khoản
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

  for r in
    select s.id, s.code, s.full_name, s.name_search,
           count(*)::int as n, coalesce(sum(se.fee), 0)::int as amt,
           (select c.bank_account_id
              from public.attendance a2
              join public.sessions se2 on se2.id = a2.session_id and se2.date >= v_start and se2.date < v_end
              join public.classes c on c.id = se2.class_id
             where a2.student_id = s.id and a2.present
             group by c.bank_account_id
             order by count(*) desc, min(c.name)
             limit 1) as acct,
           (select count(distinct c.bank_account_id)
              from public.attendance a3
              join public.sessions se3 on se3.id = a3.session_id and se3.date >= v_start and se3.date < v_end
              join public.classes c on c.id = se3.class_id
             where a3.student_id = s.id and a3.present) as n_acct
    from public.attendance a
    join public.sessions se on se.id = a.session_id and se.date >= v_start and se.date < v_end
    join public.students s on s.id = a.student_id
    where a.present
    group by s.id, s.code, s.full_name, s.name_search
  loop
    select * into v_inv from public.invoices where student_id = r.id and month = p_month;
    if not found then
      insert into public.invoices (student_id, month, sessions_count, amount, transfer_note, bank_account_id)
      values (r.id, p_month, r.n, r.amt, public.make_transfer_note(r.name_search, p_month, r.code), r.acct);
      v_created := v_created + 1;
    elsif v_inv.status = 'confirmed' then
      if v_inv.sessions_count <> r.n then
        v_warn := v_warn || jsonb_build_object('type', 'confirmed_changed', 'code', r.code, 'name', r.full_name,
                                               'old_count', v_inv.sessions_count, 'new_count', r.n);
      end if;
    else
      update public.invoices
         set sessions_count = r.n, amount = r.amt, bank_account_id = r.acct,
             transfer_note = public.make_transfer_note(r.name_search, p_month, r.code)
       where id = v_inv.id;
      v_updated := v_updated + 1;
      if v_inv.status = 'reported' and r.amt is distinct from v_inv.reported_amount then
        v_warn := v_warn || jsonb_build_object('type', 'reported_changed', 'code', r.code, 'name', r.full_name,
                                               'reported_amount', v_inv.reported_amount, 'new_amount', r.amt);
      end if;
    end if;
    if r.n_acct > 1 then
      v_warn := v_warn || jsonb_build_object('type', 'multi_account', 'code', r.code, 'name', r.full_name);
    end if;
  end loop;

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

-- Danh sách hóa đơn tháng: thêm tên tài khoản nhận tiền
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
        'bank_label', (select b.label from public.bank_accounts b where b.id = i.bank_account_id),
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

-- Điểm danh: em phải đã ghi danh lớp đó (bất kỳ khóa nào) mới tạo được dòng điểm danh, chặn cả khi gọi thẳng API
create or replace function public.attendance_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_date date;
  v_class uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select s.date into v_date from public.sessions s where s.id = old.session_id;
    if v_date is not null and public.is_month_closed(v_date) then
      raise exception 'Tháng % đã chốt. Mở lại tháng trước khi sửa điểm danh.', to_char(v_date, 'MM/YYYY');
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select s.date, s.class_id into v_date, v_class from public.sessions s where s.id = new.session_id;
    if v_date is not null and public.is_month_closed(v_date) then
      raise exception 'Tháng % đã chốt. Mở lại tháng trước khi sửa điểm danh.', to_char(v_date, 'MM/YYYY');
    end if;
    if tg_op = 'INSERT' and not exists (
         select 1 from public.enrollments e where e.student_id = new.student_id and e.class_id = v_class) then
      raise exception '% chưa được ghi danh vào lớp này nên không điểm danh được.',
        coalesce((select full_name from public.students where id = new.student_id), 'Học sinh này');
    end if;
    new.marked_at := now();
    new.marked_by := coalesce(auth.uid(), new.marked_by);
    return new;
  end if;
  return old;
end;
$$;
