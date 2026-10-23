-- 004_lookup_left_on.sql — Sửa lookup_student: left_on là ngày bắt đầu nghỉ (khớp màn hình Học sinh:
-- "bỏ chọn = cho em nghỉ lớp đó từ hôm nay"), nên ngày left_on không còn tính là đang học.
-- Thân hàm giống 001_init.sql, chỉ đổi điều kiện left_on >= thành >.

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
      -- Tháng chốt gần nhất + mọi tháng cũ chưa confirmed; tháng đang mở lại thì ẩn
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
            'month', i.month,
            'sessions_count', i.sessions_count,
            'amount', i.amount,
            'status', i.status,
            'transfer_note', i.transfer_note,
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

  if v_students = '[]'::jsonb then
    return jsonb_build_object('students', v_students);
  end if;

  return jsonb_build_object(
    'students', v_students,
    'bank', (select jsonb_build_object('bank_bin', bank_bin, 'account_no', account_no, 'account_name', account_name)
             from public.settings limit 1));
end;
$$;
