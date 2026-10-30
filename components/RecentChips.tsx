"use client";
/** Recently viewed companies as quick chips under the search bar (this browser only). */
import { useRecent } from "./saved";

export default function RecentChips({ current, onSelect }: { current: string | null; onSelect: (s: string) => void }) {
  const { list, clear } = useRecent();
  const items = list.filter((s) => s !== current);
  if (!items.length) return null;
  return (
    <div className="recent" aria-label="Recently viewed">
      <span className="ctl-label">Recent</span>
      <div className="recent-row">
        {items.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => onSelect(s)}>
            {s}
          </button>
        ))}
      </div>
      <button type="button" className="recent-clear" onClick={clear}>
        Clear
      </button>
    </div>
  );
}
