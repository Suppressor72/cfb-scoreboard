import type { Filters } from "../selectors/filters";
import { FILTER_CONFERENCES } from "../api/conferences";

interface Props {
  filters: Filters;
  onChange: (next: Filters) => void;
}

export default function FilterBar({ filters, onChange }: Props) {
  const toggleConference = (conference: string): void => {
    const has = filters.conferences.includes(conference);
    onChange({
      ...filters,
      conferences: has
        ? filters.conferences.filter((c) => c !== conference)
        : [...filters.conferences, conference],
    });
  };

  return (
    <div className="filter-bar" role="group" aria-label="Filters">
      <button
        type="button"
        className={`chip${filters.top25 ? " on" : ""}`}
        aria-pressed={filters.top25}
        onClick={() => onChange({ ...filters, top25: !filters.top25 })}
      >
        Top 25
      </button>
      {FILTER_CONFERENCES.map((c) => (
        <button
          key={c}
          type="button"
          className={`chip${filters.conferences.includes(c) ? " on" : ""}`}
          aria-pressed={filters.conferences.includes(c)}
          onClick={() => toggleConference(c)}
        >
          {c}
        </button>
      ))}
      <button
        type="button"
        className={`chip${filters.televisedOnly ? " on" : ""}`}
        aria-pressed={filters.televisedOnly}
        onClick={() => onChange({ ...filters, televisedOnly: !filters.televisedOnly })}
      >
        Televised only
      </button>
    </div>
  );
}
