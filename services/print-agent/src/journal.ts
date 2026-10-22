import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KEEP = 2000;

/**
 * Local record of job ids that were physically printed. If the agent prints
 * but crashes before telling the API, the job is reclaimed later — the journal
 * makes the agent confirm it instead of printing a second copy.
 */
export class PrintJournal {
  private readonly ids: string[];
  private readonly set: Set<string>;

  constructor(private readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.ids = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-KEEP) : [];
    this.set = new Set(this.ids);
  }

  has(jobId: string): boolean {
    return this.set.has(jobId);
  }

  add(jobId: string) {
    if (this.set.has(jobId)) return;
    this.ids.push(jobId);
    this.set.add(jobId);
    appendFileSync(this.file, `${jobId}\n`);
    if (this.ids.length > KEEP * 2) {
      const keep = this.ids.splice(0, this.ids.length - KEEP);
      keep.forEach((id) => this.set.delete(id));
      writeFileSync(this.file, this.ids.join('\n') + '\n');
    }
  }
}
