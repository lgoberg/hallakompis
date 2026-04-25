/**
 * Enkel scheduler: kjører linker + reflector kl 03 hver natt (Europe/Oslo).
 * Bruker setTimeout-rekursjon i stedet for ekstern cron-pakke.
 */
import { runLinker } from './linker.js';
import { runReflector } from './reflector.js';
import type { FastifyBaseLogger } from 'fastify';

const RUN_HOUR_OSLO = 3;       // 03:00 Oslo-tid
const MIN_WAIT_MS = 60_000;    // safety: aldri schedule oftere enn 1 min

/**
 * Beregn ms til neste kl 03 i Oslo. Bruker Intl for å få Oslo-tid robust,
 * uavhengig av server-TZ (Northflank kjører UTC).
 */
function msUntilNextRun(): number {
  const now = new Date();

  // Hva er klokka nå i Oslo, som ren tall-representasjon?
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Oslo',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const osloHour = Number(parts.hour);
  const osloMin = Number(parts.minute);
  const osloSec = Number(parts.second);

  // Sekunder fra nå til neste kl 03 (Oslo-tid)
  const secondsNowInDay = osloHour * 3600 + osloMin * 60 + osloSec;
  const targetSeconds = RUN_HOUR_OSLO * 3600;
  let deltaSeconds = targetSeconds - secondsNowInDay;
  if (deltaSeconds <= 0) deltaSeconds += 24 * 3600; // i morgen

  return Math.max(deltaSeconds * 1000, MIN_WAIT_MS);
}

export function startMemoryCron(log: FastifyBaseLogger): void {
  const schedule = (): void => {
    const wait = msUntilNextRun();
    log.info({ waitHours: (wait / 1000 / 3600).toFixed(2) }, '[memory-cron] neste kjøring');
    setTimeout(() => {
      void (async () => {
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
      })();
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
