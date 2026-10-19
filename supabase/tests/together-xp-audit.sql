-- Read-only owner audit, not a client endpoint. Never repairs historical totals.
with task_totals as (
 select space_id,sum(together_xp)::numeric as xp from public.reward_ledger where kind='together' group by space_id
), goal_totals as (
 select space_id,sum(together_xp)::numeric as xp from public.goal_reward_ledger group by space_id
), spaces as (
 select space_id from public.space_progress union select space_id from task_totals union select space_id from goal_totals
)
select s.space_id,coalesce(p.together_xp,0)::numeric as actual,
 coalesce(t.xp,0)+coalesce(g.xp,0) as recorded,
 coalesce(p.together_xp,0)-coalesce(t.xp,0)-coalesce(g.xp,0) as difference
from spaces s left join public.space_progress p using(space_id)
left join task_totals t using(space_id) left join goal_totals g using(space_id)
where coalesce(p.together_xp,0)<>coalesce(t.xp,0)+coalesce(g.xp,0);
