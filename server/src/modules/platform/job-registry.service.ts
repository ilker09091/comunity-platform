import { Injectable } from '@nestjs/common';

export interface JobRun {
  name: string;
  schedule: string;
  description: string;
  lastRunAt: string | null;
  lastStatus: 'OK' | 'FAILED' | null;
  lastDetail: string | null;
}

/** In-process record of scheduled job runs, reported on System Status. */
@Injectable()
export class JobRegistryService {
  private readonly jobs = new Map<string, JobRun>();

  register(name: string, schedule: string, description: string) {
    if (!this.jobs.has(name))
      this.jobs.set(name, { name, schedule, description, lastRunAt: null, lastStatus: null, lastDetail: null });
  }

  record(name: string, status: 'OK' | 'FAILED', detail: string) {
    const job = this.jobs.get(name);
    if (!job) return;
    job.lastRunAt = new Date().toISOString();
    job.lastStatus = status;
    job.lastDetail = detail.slice(0, 300);
  }

  list(): JobRun[] {
    return [...this.jobs.values()].map((job) => ({ ...job }));
  }
}
