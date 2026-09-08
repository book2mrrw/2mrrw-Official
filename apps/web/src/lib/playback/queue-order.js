// Shared by preloading and advancement: inspecting the next track never consumes it.
export function nextQueueIndex(queue, currentIndex, {
  shuffleRef, repeatModeRef, shuffledOrderRef, shufflePositionRef,
}, { advance = false, random = Math.random } = {}) {
  if (!queue.length) return -1;
  if (!shuffleRef.current || queue.length < 2) {
    const next = currentIndex + 1;
    return next < queue.length ? next : repeatModeRef.current === "all" ? 0 : -1;
  }
  let order = shuffledOrderRef.current;
  let position = shufflePositionRef.current;
  if (!order || order.length !== queue.length || order[position] !== currentIndex) {
    const remaining = queue.map((_, i) => i).filter((i) => i !== currentIndex);
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    order = [currentIndex, ...remaining];
    position = 0;
    shuffledOrderRef.current = order;
    shufflePositionRef.current = position;
  }
  if (position + 1 >= order.length) {
    if (repeatModeRef.current !== "all") return -1;
    // Repeat the established permutation; peek and advance must agree even at wrap.
    if (advance) shufflePositionRef.current = 0;
    return order[0];
  }
  if (advance) shufflePositionRef.current = position + 1;
  return order[position + 1];
}
