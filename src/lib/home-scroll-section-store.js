"use client";

/** Scroll-section sync for mobile home nav — avoids full Page re-renders on intersection changes. */

let homeScrollSection = null;
const listeners = new Set();

export function getHomeScrollSection() {
  return homeScrollSection;
}

export function setHomeScrollSection(next) {
  if (homeScrollSection === next) return;
  homeScrollSection = next;
  listeners.forEach((listener) => listener());
}

export function subscribeHomeScrollSection(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
