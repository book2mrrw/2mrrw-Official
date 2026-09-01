"use client";

/** @type {string[]} */
const modalStack = [];

let bodyScrollLocked = false;
/** @type {string | null} */
let savedBodyOverflow = null;

function lockBodyScroll() {
  if (typeof document === "undefined" || bodyScrollLocked) return;
  savedBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  bodyScrollLocked = true;
}

function unlockBodyScroll() {
  if (typeof document === "undefined" || !bodyScrollLocked) return;
  document.body.style.overflow = savedBodyOverflow ?? "";
  savedBodyOverflow = null;
  bodyScrollLocked = false;
}

/**
 * Register an open modal/sheet. First registration applies a single body scroll lock.
 * @param {string} id
 */
export function registerModal(id) {
  if (!id || modalStack.includes(id)) return;
  modalStack.push(id);
  if (modalStack.length === 1) lockBodyScroll();
}

/**
 * Unregister on close/unmount. Restores body scroll only when stack is empty.
 * @param {string} id
 */
export function unregisterModal(id) {
  const idx = modalStack.indexOf(id);
  if (idx < 0) return;
  modalStack.splice(idx, 1);
  if (modalStack.length === 0) unlockBodyScroll();
}

/** @returns {string | null} */
export function getTopModal() {
  return modalStack.length ? modalStack[modalStack.length - 1] : null;
}

/** @returns {number} */
export function getModalStackDepth() {
  return modalStack.length;
}

/** @returns {readonly string[]} */
export function getModalStackSnapshot() {
  return [...modalStack];
}

/** Dev/test helper — clears stack and unlocks body. */
export function __resetModalStackForTests() {
  modalStack.length = 0;
  unlockBodyScroll();
}
