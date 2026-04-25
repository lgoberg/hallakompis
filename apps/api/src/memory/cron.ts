/**
 * Enkel scheduler: kjører linker + reflector kl 03 hver natt.
 * Bruker setTimeout-rekursjon i stedet for ekstern cron-pakke.
 */
import { runLinker } from './linker.js';
import { runReflector } from './reflector.js';
import type { FastifyBaseLogger } from 'fastify';

const TZ = 'Europe/Oslo';
const RUN_HOUR = 3; // 03:00 Oslo-tid

function msUntilNextRun(): number {
  const now = new Date();
  const oslo = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const offset = now.getTime() - oslo.getTime();

  const target = new Date(oslo);
  target.setHours(RUN_HOUR, 0, 0, 0);
  if (target <= oslo) target.setDate(target.getDate() + 1);

  return target.getTime() - oslo.getTime() + offset;
}

export function startMemoryCron(log: FastifyBaseLogger): void {
  const schedule = (): void => {
    const wait = msUntilNextRun();
    log.info({ waitHours: (wait / 1000 / 3600).toFixed(2) }, '[memory-cron] neste kjøring');
    setTimeout(async () => {
      try {
        log.info('[memory-cron] kjører linker');
        const linkResult = await runLinker();
        log.info({ result: linkResult }, '[memory-cron] linker ferdig');

        log.info('[memory-cron] kjører reflector');
        const reflectResult = await runReflector();
        log.info({ result: reflectResult }, '[memory-cron] reflector ferdig');
      } catch (err) {
        log.error({ err }, '[memory-cron] feilet');
      }
      schedule();
    }, wait);
  };
  schedule();
}

/** Manuell trigger – brukes via env flag for testing */
export async function runMemoryJobNow(log: FastifyBaseLogger): Promise<void> {
  log.info('[memory-cron] manuell trigger: linker');
  const linkResult = await runLinker();
  log.info({ result: linkResult }, '[memory-cron] manuell linker ferdig');

  log.info('[memory-cron] manuell trigger: reflector');
  const reflectResult = await runReflector();
  log.info({ result: reflectResult }, '[memory-cron] manuell reflector ferdig');
}
