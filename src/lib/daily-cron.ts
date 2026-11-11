export interface DailyTaskDetail {
  status: number;
  durationMs: number;
  body: Record<string, unknown> | null;
  error?: string;
}

export interface DailyCronReport {
  sync: number;
  health: number;
  totalDurationMs: number;
  details: { sync: DailyTaskDetail; health: DailyTaskDetail };
}

async function runDetailedStep(task: () => Promise<Response>): Promise<DailyTaskDetail> {
  const startedAt = Date.now();
  try {
    const res = await task();
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = await res.clone().json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      body = null;
    }
    return { status: res.status, durationMs: Date.now() - startedAt, body };
  } catch (e) {
    return {
      status: 503,
      durationMs: Date.now() - startedAt,
      body: null,
      error: e instanceof Error ? e.message.slice(0, 200) : 'task_failed',
    };
  }
}

export async function runDailyTasks(sync: () => Promise<Response>, health: () => Promise<Response>): Promise<{ sync: number; health: number }> {
  const run = async (task: () => Promise<Response>) => {
    try { return (await task()).status; } catch { return 503; }
  };
  return { sync: await run(sync), health: await run(health) };
}

export async function runDailyTasksDetailed(
  sync: () => Promise<Response>,
  health: () => Promise<Response>,
): Promise<DailyCronReport> {
  const startedAt = Date.now();
  const syncResult = await runDetailedStep(sync);
  const healthResult = await runDetailedStep(health);
  return {
    sync: syncResult.status,
    health: healthResult.status,
    totalDurationMs: Date.now() - startedAt,
    details: { sync: syncResult, health: healthResult },
  };
}
