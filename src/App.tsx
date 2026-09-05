import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import DayTabs from "./components/DayTabs";
import FilterBar from "./components/FilterBar";
import GameDetails from "./components/GameDetails";
import Grid from "./components/Grid";
import MobileList from "./components/MobileList";
import type { Filters } from "./selectors/filters";
import { NO_FILTERS, applyFilters, hasActiveFilters } from "./selectors/filters";
import { gamesForDay, timeTbaGames } from "./selectors/grouping";
import { addDaysIso, todayInTz, weekDays, weekStartFor } from "./lib/dates";
import { TZ } from "./lib/tz";
import { getWeek, refreshWeek, subscribe } from "./state/store";
import { startScheduler } from "./state/scheduler";
import {
  getPrediction,
  predictorVersion,
  subscribePredictors,
  syncPredictors,
} from "./state/predictor";
import type { WinProb } from "./api/types";

const FILTERS_KEY = "cfb-scoreboard:filters:v1";

function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return NO_FILTERS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return NO_FILTERS;
    const p = parsed as Record<string, unknown>;
    return {
      top25: p.top25 === true,
      conferences: Array.isArray(p.conferences)
        ? p.conferences.filter((c): c is string => typeof c === "string")
        : [],
      televisedOnly: p.televisedOnly === true,
    };
  } catch {
    return NO_FILTERS; // corrupt storage must never block startup
  }
}

function initialSelection(): { day: string; week: string } {
  let day = todayInTz(TZ);
  try {
    const param = new URLSearchParams(window.location.search).get("date");
    if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) day = param;
  } catch {
    // no window — tests
  }
  return { day, week: weekStartFor(Date.parse(`${day}T12:00:00Z`), TZ) };
}

const INITIAL = initialSelection();

export default function App() {
  const [weekStart, setWeekStart] = useState(INITIAL.week);
  const [selectedDay, setSelectedDay] = useState(INITIAL.day);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [popupOrigin, setPopupOrigin] = useState<{ x: number; y: number } | null>(
    null,
  );
  const selectGame = useCallback((id: string, origin: { x: number; y: number }) => {
    setSelectedGameId(id);
    setPopupOrigin(origin);
  }, []);
  const [focusChannel, setFocusChannel] = useState<string | null>(null);
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set());
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia("(max-width: 719px)").matches,
  );

  const week = useSyncExternalStore(subscribe, () => getWeek(weekStart));
  const snapshot = week.snapshot;

  // Scheduler runs against a ref so changing days/tabs never restarts timers
  const selectedDayRef = useRef(selectedDay);
  selectedDayRef.current = selectedDay;
  useEffect(
    () => startScheduler({ weekStart, tz: TZ, getSelectedDay: () => selectedDayRef.current }),
    [weekStart],
  );

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      // storage unavailable — preferences just won't persist
    }
  }, [filters]);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("date", selectedDay);
      window.history.replaceState(null, "", url);
    } catch {
      // no window — tests
    }
  }, [selectedDay]);

  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(max-width: 719px)");
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const dayGames = useMemo(
    () => (snapshot ? gamesForDay(snapshot.games, selectedDay, TZ) : []),
    [snapshot, selectedDay],
  );
  const filtered = useMemo(() => applyFilters(dayGames, filters), [dayGames, filters]);
  // Win probabilities live in their own cache; re-merge on version bumps
  const predVersion = useSyncExternalStore(subscribePredictors, predictorVersion);
  const predictions = useMemo(() => {
    const map = new Map<string, WinProb | null>();
    for (const g of dayGames) map.set(g.id, getPrediction(g.id));
    return map;
  }, [dayGames, predVersion]);
  useEffect(() => {
    if (dayGames.length > 0) void syncPredictors(dayGames, { burst: true });
  }, [dayGames]);
  const onAxis = useMemo(() => filtered.filter((g) => !g.timeTbd), [filtered]);
  const tba = useMemo(
    () => timeTbaGames(filtered, selectedDay, TZ),
    [filtered, selectedDay],
  );
  const badges = useMemo(() => {
    const map: Record<string, { live: number; done: boolean; count: number }> = {};
    for (const day of days) {
      const games = snapshot ? gamesForDay(snapshot.games, day, TZ) : [];
      map[day] = {
        live: games.filter((g) => g.phase === "in").length,
        done: games.length > 0 && games.every((g) => g.phase === "post"),
        count: games.length,
      };
    }
    return map;
  }, [snapshot, days]);
  // Once the week is loaded, gameless days lose their tab — except the
  // selected day, so deep-links and explicit navigation stay coherent.
  const visibleDays = useMemo(() => {
    if (!snapshot) return days;
    return days.filter((day) => day === selectedDay || (badges[day]?.count ?? 0) > 0);
  }, [days, snapshot, selectedDay, badges]);
  const selectedGame = useMemo(
    () => dayGames.find((g) => g.id === selectedGameId) ?? null,
    [dayGames, selectedGameId],
  );

  const handleRefresh = useCallback(() => {
    void refreshWeek(weekStart, TZ, { force: true });
  }, [weekStart]);

  const handleSelectDay = useCallback(
    (day: string) => {
      setSelectedDay(day);
      setSelectedGameId(null);
    },
    [],
  );
  const handleShiftWeek = useCallback((dir: number) => {
    setWeekStart((w) => addDaysIso(w, dir * 7));
    setSelectedGameId(null);
  }, []);
  const handleToday = useCallback(() => {
    setWeekStart(weekStartFor(Date.now(), TZ));
    setSelectedDay(todayInTz(TZ));
    setSelectedGameId(null);
  }, []);

  const missingData = week.state === "idle" || (week.state === "loading" && !snapshot);

  return (
    <div className="app">
      <header className="app-header">
        <h1>CFB Scoreboard</h1>
        <RefreshStatus state={week} onRefresh={handleRefresh} />
      </header>

      <DayTabs
        days={visibleDays}
        selected={selectedDay}
        badges={badges}
        onSelect={handleSelectDay}
        onShiftWeek={handleShiftWeek}
        onToday={handleToday}
        showToday={selectedDay !== todayInTz(TZ) || weekStart !== weekStartFor(Date.now(), TZ)}
      />

      <FilterBar filters={filters} onChange={setFilters} />

      <main>
        {week.state === "error" && !snapshot ? (
          <div className="panel error-panel" role="alert">
            <p>Couldn't load the scoreboard.</p>
            <p className="muted">{week.error?.message}</p>
            <button type="button" onClick={handleRefresh}>
              Retry
            </button>
          </div>
        ) : missingData ? (
          <div className="skeleton" aria-label="Loading scoreboard">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton-row" />
            ))}
          </div>
        ) : (
          <>
            {narrow ? (
              <MobileList
                games={filtered}
                tz={TZ}
                predictions={predictions}
                onSelectGame={selectGame}
              />
            ) : (
              <Grid
                games={onAxis}
                tz={TZ}
                predictions={predictions}
                focusChannel={focusChannel}
                expandedChannels={expandedChannels}
                onToggleChannel={setFocusChannel}
                onToggleExpand={(channel) =>
                  setExpandedChannels((prev) => {
                    const next = new Set(prev);
                    if (next.has(channel)) next.delete(channel);
                    else next.add(channel);
                    return next;
                  })
                }
                onSelectGame={selectGame}
                selectedGameId={selectedGameId}
              />
            )}

            {tba.length > 0 && (
              <div className="tba-strip">
                <h2>Time TBA</h2>
                {tba.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="tba-game"
                    onClick={(e) => selectGame(g.id, { x: e.clientX, y: e.clientY })}
                  >
                    {g.away.abbreviation} vs {g.home.abbreviation}
                    {g.primaryBroadcast ? ` · ${g.primaryBroadcast}` : ""}
                    {g.availability === "unknown" ? " · TV?" : ""}
                  </button>
                ))}
              </div>
            )}

            {filtered.length === 0 && (
              <div className="panel empty-panel">
                {hasActiveFilters(filters) ? (
                  <>
                    <p>No games match the active filters.</p>
                    <button type="button" onClick={() => setFilters(NO_FILTERS)}>
                      Clear filters
                    </button>
                  </>
                ) : (
                  <p>No games scheduled this day.</p>
                )}
              </div>
            )}

            {snapshot?.coverage === "partial" && (
              <p className="muted partial-note" role="status">
                {snapshot.warnings.length} game
                {snapshot.warnings.length === 1 ? "" : "s"} skipped due to provider
                data issues.
              </p>
            )}
          </>
        )}
      </main>

      {selectedGame && (
        <GameDetails
          game={selectedGame}
          tz={TZ}
          winProb={predictions.get(selectedGame.id) ?? null}
          origin={popupOrigin}
          onClose={() => setSelectedGameId(null)}
        />
      )}
    </div>
  );
}

function RefreshStatus({
  state,
  onRefresh,
}: {
  state: ReturnType<typeof getWeek>;
  onRefresh: () => void;
}) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    // Tick every second so the "updated Xs ago" counter actually counts
    const t = setInterval(() => forceTick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);

  let text: string;
  let live = false;
  if (state.state === "loading" || state.state === "idle") text = "Loading…";
  else if (state.snapshot) {
    const agoMs = Date.now() - Date.parse(state.snapshot.lastSuccessAt);
    const ago = agoMs < 60_000 ? `${Math.round(agoMs / 1000)}s` : `${Math.round(agoMs / 60_000)}m`;
    if (state.state === "error") text = `Connection issue — showing data from ${ago} ago`;
    else {
      text = `Updated ${ago} ago`;
      live = true;
    }
  } else text = "Not loaded";

  return (
    <div className="refresh-status">
      <span className={live ? "dot live" : "dot stale"} aria-hidden="true" />
      <span>{text}</span>
      <button type="button" onClick={onRefresh} aria-label="Refresh now">
        ↻
      </button>
    </div>
  );
}
