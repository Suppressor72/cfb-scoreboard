import { formatDayLabel } from "../lib/dates";

export interface DayBadge {
  live: number;
  done: boolean;
}

interface Props {
  days: string[];
  selected: string;
  badges: Record<string, DayBadge>;
  onSelect: (day: string) => void;
  onShiftWeek: (direction: number) => void;
  onToday: () => void;
  showToday: boolean;
}

/** Day tabs with WAI-ARIA tabs keyboard behavior (arrows, Home/End). */
export default function DayTabs({
  days,
  selected,
  badges,
  onSelect,
  onShiftWeek,
  onToday,
  showToday,
}: Props) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const idx = days.indexOf(selected);
    if (e.key === "ArrowRight") onSelect(days[Math.min(idx + 1, days.length - 1)]);
    else if (e.key === "ArrowLeft") onSelect(days[Math.max(idx - 1, 0)]);
    else if (e.key === "Home") onSelect(days[0]);
    else if (e.key === "End") onSelect(days[days.length - 1]);
    else return;
    e.preventDefault();
  };

  return (
    <div className="week-nav">
      <button
        type="button"
        className="week-arrow"
        onClick={() => onShiftWeek(-1)}
        aria-label="Previous week"
      >
        ‹
      </button>
      <div className="day-tabs" role="tablist" aria-label="Game day" onKeyDown={handleKeyDown}>
        {days.map((day) => {
          const badge = badges[day];
          const isSel = day === selected;
          return (
            <button
              key={day}
              type="button"
              role="tab"
              aria-selected={isSel}
              tabIndex={isSel ? 0 : -1}
              className={`day-tab${isSel ? " selected" : ""}${badge?.done ? " done" : ""}`}
              onClick={() => onSelect(day)}
            >
              <span className="day-label">{formatDayLabel(day)}</span>
              {badge && badge.live > 0 && (
                <span className="live-badge">
                  <span className="pulse-dot" aria-hidden="true" />
                  {badge.live} live
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="week-arrow"
        onClick={() => onShiftWeek(1)}
        aria-label="Next week"
      >
        ›
      </button>
      {showToday && (
        <button type="button" className="today-btn" onClick={onToday}>
          Today
        </button>
      )}
    </div>
  );
}
