/** US stock market session (NYSE / Nasdaq regular hours, 9:30 to 16:00 New York time, weekdays). Exchange holidays are not modelled. */

export interface MarketClock {
  open: boolean;
  /** e.g. "Closes in 2h 14m", "Opens in 9h 30m", "Opens Monday 9:30 ET". */
  label: string;
}

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function nyParts(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { day, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const span = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`);

export function marketClock(now = new Date()): MarketClock {
  const { day, minutes } = nyParts(now);
  const weekday = day >= 1 && day <= 5;
  if (weekday && minutes >= OPEN_MIN && minutes < CLOSE_MIN) return { open: true, label: `Closes in ${span(CLOSE_MIN - minutes)}` };
  if (weekday && minutes < OPEN_MIN) return { open: false, label: `Opens in ${span(OPEN_MIN - minutes)}` };
  // After the close or at the weekend: next weekday morning.
  let next = (day + 1) % 7;
  while (next === 0 || next === 6) next = (next + 1) % 7;
  const untilMidnight = 24 * 60 - minutes;
  const daysBetween = (next - day + 7) % 7 - 1;
  const mins = untilMidnight + daysBetween * 24 * 60 + OPEN_MIN;
  return { open: false, label: mins < 24 * 60 ? `Opens in ${span(mins)}` : `Opens ${DAYS[next]} 9:30 ET` };
}
