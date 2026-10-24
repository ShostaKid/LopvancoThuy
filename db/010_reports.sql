-- 010_reports.sql — Bước 7: báo cáo (SPEC.md 7 A6) và rút gọn tên trong nội dung chuyển khoản (6.2)
-- Các hàm báo cáo là SECURITY INVOKER: vẫn đi qua RLS (chỉ nhân sự xem được).

-- Nội dung chuyển khoản: tên quá dài thì RÚT GỌN các từ đầu thành chữ cái đầu (giữ nguyên từ cuối, mã HS và "HOC PHI T..").
-- VD NGUYEN NGOC VAN LINH -> N N V LINH. Rút lần lượt từ trái sang cho tới khi vừa 50 ký tự; chỉ khi vẫn dài mới cắt.
create or replace function public.make_transfer_note(p_name_search text, p_month text, p_code text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_suffix text := ' HOC PHI T' || (substr(p_month, 6, 2))::int::text || ' ' || upper(p_code);
  v_words text[] := string_to_array(
    btrim(regexp_replace(regexp_replace(upper(p_name_search), '[^A-Z0-9 ]', '', 'g'), ' +', ' ', 'g')), ' ');
  v_name text;
  i int := 1;
begin
  while length(array_to_string(v_words, ' ')) + length(v_suffix) > 50 and i < coalesce(array_length(v_words, 1), 0) loop
    v_words[i] := left(v_words[i], 1);
    i := i + 1;
  end loop;
  v_name := array_to_string(v_words, ' ');
  v_name := btrim(left(v_name, greatest(0, 50 - length(v_suffix))));
  return btrim(v_name || v_suffix);
end;
$$;

-- Báo cáo 1 tháng theo lớp: số buổi đã dạy, lượt có mặt / vắng, online / offline, doanh thu (từng buổi có mặt, SPEC A6)
create or replace function public.month_report(p_month text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row order by row ->> 'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'class_id', c.id, 'name', c.name,
      'sessions', count(distinct se.id),
      'present', count(a.student_id) filter (where a.present),
      'absent', count(a.student_id) filter (where not a.present),
      'online', count(a.student_id) filter (where a.present and a.mode = 'online'),
      'offline', count(a.student_id) filter (where a.present and a.mode = 'offline'),
      'revenue', coalesce(sum(se.fee) filter (where a.present), 0)
    ) as row
    from public.sessions se
    join public.classes c on c.id = se.class_id
    left join public.attendance a on a.session_id = se.id
    where to_char(se.date, 'YYYY-MM') = p_month
    group by c.id, c.name
  ) x;
$$;

-- Báo cáo theo khóa: mỗi dòng là 1 tháng trong khoảng ngày của khóa (chỉ tháng có dữ liệu hoặc đã chốt)
create or replace function public.term_report(p_term_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with t as (
    select to_char(start_date, 'YYYY-MM') as m1, to_char(end_date, 'YYYY-MM') as m2 from public.terms where id = p_term_id
  ),
  months as (
    select to_char(se.date, 'YYYY-MM') as m from public.sessions se, t where to_char(se.date, 'YYYY-MM') between t.m1 and t.m2
    union select i.month from public.invoices i, t where i.month between t.m1 and t.m2
    union select mc.month from public.month_closings mc, t where mc.month between t.m1 and t.m2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'month', months.m,
    'closed', exists (select 1 from public.month_closings mc where mc.month = months.m),
    'total', (select coalesce(sum(amount), 0) from public.invoices i where i.month = months.m),
    'confirmed', (select coalesce(sum(amount), 0) from public.invoices i where i.month = months.m and i.status = 'confirmed'),
    'reported', (select coalesce(sum(amount), 0) from public.invoices i where i.month = months.m and i.status = 'reported'),
    'unpaid', (select coalesce(sum(amount), 0) from public.invoices i where i.month = months.m and i.status = 'unpaid'),
    'sessions', (select count(*) from public.sessions se where to_char(se.date, 'YYYY-MM') = months.m),
    'present', (select count(*) from public.attendance a join public.sessions se on se.id = a.session_id
                where a.present and to_char(se.date, 'YYYY-MM') = months.m),
    'revenue', (select coalesce(sum(se.fee), 0) from public.attendance a join public.sessions se on se.id = a.session_id
                where a.present and to_char(se.date, 'YYYY-MM') = months.m)
  ) order by months.m), '[]'::jsonb)
  from months;
$$;

-- Điểm danh của 1 tháng dạng phẳng để xuất file (1 hàm trả 1 giá trị jsonb nên không vướng giới hạn 1000 dòng của API)
create or replace function public.month_attendance(p_month text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', se.date, 'class', c.name, 'code', s.code, 'full_name', s.full_name,
    'present', a.present, 'mode', a.mode
  ) order by se.date, c.name, s.code), '[]'::jsonb)
  from public.attendance a
  join public.sessions se on se.id = a.session_id
  join public.classes c on c.id = se.class_id
  join public.students s on s.id = a.student_id
  where to_char(se.date, 'YYYY-MM') = p_month;
$$;

revoke execute on function public.make_transfer_note(text, text, text), public.month_report(text),
  public.term_report(uuid), public.month_attendance(text) from public, anon;
grant execute on function public.make_transfer_note(text, text, text), public.month_report(text),
  public.term_report(uuid), public.month_attendance(text) to authenticated;
