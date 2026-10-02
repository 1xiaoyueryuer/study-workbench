import { useEffect, useState } from "react";
import type { PageActions } from "../pages/Shop";
export function FileTask({ call }: { call: PageActions["call"] }) {
  const [job, setJob] = useState<{
    jobId: string;
    name: string;
    completed: number;
    total: number;
    bytes: number;
    active: boolean;
  } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      void call("getImportProgress")
        .then(setJob)
        .catch(() => {});
    }, 500);
    return () => clearInterval(timer);
  }, [call]);
  return job?.active ? (
    <div className="file-task" role="status">
      <span>
        {job.name} · {job.completed}/{job.total} ·{" "}
        {(job.bytes / 1024 ** 2).toFixed(1)} MiB
      </span>
      <button onClick={() => void call("cancelImport", { jobId: job.jobId })}>
        取消任务
      </button>
    </div>
  ) : null;
}
