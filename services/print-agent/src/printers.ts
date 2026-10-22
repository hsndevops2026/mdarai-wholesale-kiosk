import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import type { AgentConfig } from './config';
import { encodeRaster } from './escpos';
import type { RenderedSlip } from './types';

export interface Printer {
  readonly name: string;
  print(jobId: string, slip: RenderedSlip): Promise<void>;
}

/** Raw TCP (port 9100 / "JetDirect") — supported by practically all network thermal printers. */
export class NetworkPrinter implements Printer {
  readonly name: string;
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 15000,
  ) {
    this.name = `network:${host}:${port}`;
  }

  print(_jobId: string, slip: RenderedSlip): Promise<void> {
    const data = encodeRaster(slip.rgba, slip.width, slip.height);
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.host, port: this.port });
      const fail = (err: Error) => {
        socket.destroy();
        reject(err);
      };
      socket.setTimeout(this.timeoutMs, () => fail(new Error(`printer timeout (${this.host}:${this.port})`)));
      socket.once('error', (e) => fail(new Error(`printer unreachable: ${e.message}`)));
      socket.once('connect', () => socket.end(data));
      socket.once('close', (hadError) => {
        if (!hadError) resolve();
      });
    });
  }
}

/** Development/testing: writes PNG + text + raw ESC/POS bytes to a folder. */
export class SimulatedPrinter implements Printer {
  readonly name = 'simulated';
  private failuresLeft: number;

  constructor(
    private readonly dir: string,
    failFirst = 0,
  ) {
    this.failuresLeft = failFirst;
  }

  async print(jobId: string, slip: RenderedSlip): Promise<void> {
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      throw new Error('simulated paper jam');
    }
    await mkdir(this.dir, { recursive: true });
    const base = path.join(this.dir, jobId);
    await writeFile(`${base}.png`, slip.png);
    await writeFile(`${base}.txt`, slip.text, 'utf8');
    await writeFile(`${base}.escpos.bin`, encodeRaster(slip.rgba, slip.width, slip.height));
  }
}

export class StdoutPrinter implements Printer {
  readonly name = 'stdout';
  async print(_jobId: string, slip: RenderedSlip): Promise<void> {
    process.stdout.write(slip.text + '\n');
  }
}

export function createPrinter(cfg: AgentConfig): Printer {
  if (cfg.mode === 'network') return new NetworkPrinter(cfg.printerHost, cfg.printerPort);
  if (cfg.mode === 'stdout') return new StdoutPrinter();
  return new SimulatedPrinter(cfg.outputDir, cfg.simulateFailures);
}
