-- 002_staff_roles.sql — Bước 2: vai trò Admin / co-admin (SPEC.md mục 2, 4.10, 5)
-- Thay quy ước cũ "ai đăng nhập được = admin": giờ phải có trong bảng staff mới làm được gì.

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'co_admin')),
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- Vai trò của người đang gọi API; null nếu không có trong staff.
-- SECURITY DEFINER để policy gọi được mà không vướng RLS của chính bảng staff.
create or replace function public.staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.staff where user_id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.staff_role() is not null
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(public.staff_role() = 'admin', false)
$$;

-- ===================== Policy theo vai trò =====================

do $$
declare
  t text;
begin
  foreach t in array array['terms', 'classes', 'students', 'enrollments', 'settings',
                           'sessions', 'attendance', 'month_closings', 'invoices'] loop
    execute format('drop policy admin_all on public.%I', t);
  end loop;

  -- Admin và co-admin như nhau
  foreach t in array array['terms', 'classes', 'students', 'enrollments', 'sessions', 'attendance'] loop
    execute format('create policy staff_all on public.%I for all to authenticated
                    using ((select public.is_staff())) with check ((select public.is_staff()))', t);
  end loop;

  -- Ai trong staff cũng đọc được; chỉ Admin ghi (chốt tháng, cài đặt)
  foreach t in array array['settings', 'month_closings', 'invoices'] loop
    execute format('create policy staff_select on public.%I for select to authenticated
                    using ((select public.is_staff()))', t);
    execute format('create policy admin_insert on public.%I for insert to authenticated
                    with check ((select public.is_admin()))', t);
    execute format('create policy admin_delete on public.%I for delete to authenticated
                    using ((select public.is_admin()))', t);
  end loop;

  foreach t in array array['settings', 'month_closings'] loop
    execute format('create policy admin_update on public.%I for update to authenticated
                    using ((select public.is_admin())) with check ((select public.is_admin()))', t);
  end loop;
end $$;

-- Hóa đơn: co-admin được đổi trạng thái (xác nhận, hoàn tác); trigger bên dưới chặn sửa số liệu
create policy staff_update on public.invoices for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Bảng staff: người trong staff đọc được (để hiện tên); không ai ghi qua API, gán vai trò bằng SQL
alter table public.staff enable row level security;
create policy staff_select on public.staff for select to authenticated
  using ((select public.is_staff()));
revoke insert, update, delete, truncate on public.staff from authenticated;

-- ===================== Trigger =====================

-- Gọi qua API mà không phải Admin thì chỉ được đổi trạng thái hóa đơn (SPEC 5).
-- auth.uid() null là chạy từ SQL Editor, hoặc RPC của phụ huynh (RPC đó không đụng các cột này).
create or replace function public.invoices_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.student_id, new.month, new.sessions_count, new.amount, new.transfer_note)
         is distinct from (old.student_id, old.month, old.sessions_count, old.amount, old.transfer_note) then
    raise exception 'Chỉ Admin được sửa số buổi, số tiền hoặc nội dung chuyển khoản của hóa đơn.';
  end if;
  return new;
end;
$$;

create trigger invoices_before_update
before update on public.invoices
for each row execute function public.invoices_before_update();

-- ===================== Quyền gọi hàm =====================

revoke execute on function public.staff_role(), public.is_staff(), public.is_admin(),
                           public.invoices_before_update() from public, anon;
grant execute on function public.staff_role(), public.is_staff(), public.is_admin(),
                          public.invoices_before_update() to authenticated;
