"use client";

import { useEffect, useState } from "react";

const ETHIOPIA_TIME_ZONE = "Africa/Addis_Ababa";

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ETHIOPIA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

function splitTimeParts(value: string) {
  const match = value.match(/^(.+?)\s*([ap]m)$/i);

  if (!match) {
    return {
      clock: value,
      meridiem: "",
    };
  }

  return {
    clock: match[1],
    meridiem: match[2].toUpperCase(),
  };
}

export function EthiopiaLiveTime() {
  const [time, setTime] = useState("--:--:--");

  useEffect(() => {
    function updateTime() {
      setTime(timeFormatter.format(new Date()));
    }

    updateTime();

    const intervalId = window.setInterval(updateTime, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const { clock, meridiem } = splitTimeParts(time);

  return (
    <div className="flex w-fit flex-col items-center justify-center gap-1 text-center">
      <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[color:var(--ink-soft)]">
        Ethiopia time
      </span>
      <time
        dateTime={time}
        aria-label={`Current Ethiopia time ${time}`}
        className="flex flex-col items-center gap-0.5 leading-none text-[color:var(--ink)]"
      >
        <span className="font-mono text-[17px] font-semibold tracking-[0.18em] sm:text-[18px]">
          {clock}
        </span>
        {meridiem ? (
          <span className="font-mono text-[11px] font-semibold tracking-[0.26em] text-[color:var(--ink)]">
            {meridiem}
          </span>
        ) : null}
      </time>
    </div>
  );
}
