import { useEffect, useState } from "react";
import type { TeamResult } from "../api/types";

/**
 * Team emblem with a fallback chain: dark variant → standard variant →
 * hidden (broken images never show an icon). Logos are decorative — team
 * names carry the accessible label — and lazy-load offscreen.
 */
export default function TeamLogo({
  team,
  size,
}: {
  team: TeamResult;
  size: number;
}) {
  const primary = team.logoDark ?? team.logo ?? null;
  const [src, setSrc] = useState<string | null>(primary);

  useEffect(() => {
    setSrc(team.logoDark ?? team.logo ?? null);
  }, [team.logoDark, team.logo]);

  if (!src) return null;
  return (
    <img
      className="team-logo"
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      width={size}
      height={size}
      onError={() => {
        if (src !== team.logo && team.logo) setSrc(team.logo);
        else setSrc(null);
      }}
    />
  );
}
