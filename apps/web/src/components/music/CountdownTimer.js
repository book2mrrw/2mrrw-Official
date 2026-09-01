"use client";

import { useEffect, useState } from "react";

function getTimeLeft(targetDate) {
  const total = new Date(targetDate) - new Date();
  return {
    total,
    days: Math.floor(total / (1000 * 60 * 60 * 24)),
    hours: Math.floor((total / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((total / 1000 / 60) % 60),
    seconds: Math.floor((total / 1000) % 60),
  };
}

export function CountdownTimer({ targetDate }) {
  const [time, setTime] = useState(() => getTimeLeft(targetDate));

  useEffect(() => {
    const interval = setInterval(() => setTime(getTimeLeft(targetDate)), 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  if (!targetDate || time.total <= 0) return null;

  return (
    <div className="countdown-timer">
      {time.days > 0 ? <span>{time.days}D</span> : null}
      <span>{String(time.hours).padStart(2, "0")}</span>
      <span className="countdown-sep">:</span>
      <span>{String(time.minutes).padStart(2, "0")}</span>
      <span className="countdown-sep">:</span>
      <span>{String(time.seconds).padStart(2, "0")}</span>
    </div>
  );
}

export default CountdownTimer;
