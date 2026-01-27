/**
 * Everything the services need to talk to "the server".
 *
 * TODAY: services read and write the in-memory mock database below.
 * LATER: point API_BASE_URL at the NestJS API and replace the body of each
 *        service function with the `http` call shown in its "Real API" comment.
 *        Screens and hooks don't change.
 */
import { buildSeed, secondDemoFirm } from "../mock/seed";
import type { Db } from "../mock/db";

export const API_BASE_URL = "https://api.hisaab.example/v1";

// ---------------------------------------------------------------------------
// Mock database: one set of books per firm, one of them open at a time
// ---------------------------------------------------------------------------

let books: Db[] | null = null;
let activeFirmId = "";

function allBooks(): Db[] {
  if (!books) {
    books = [buildSeed(), secondDemoFirm()];
    activeFirmId = books[0].firm.id;
  }
  return books;
}

/** Books of the firm that is open right now. */
export function getDb(): Db {
  const list = allBooks();
  return list.find((b) => b.firm.id === activeFirmId) ?? list[0];
}

/** Every firm's books (for the firm switcher). */
export function getAllBooks(): Db[] {
  return allBooks();
}

export function setActiveFirm(id: string): void {
  if (!allBooks().some((b) => b.firm.id === id))
    throw new Error("Firm not found");
  activeFirmId = id;
}

export function addBooks(db: Db): void {
  allBooks().push(db);
}

/** Put restored books in place of the same firm's books (or add them) and open them. */
export function restoreBooks(db: Db): void {
  const list = allBooks();
  const i = list.findIndex((b) => b.firm.id === db.firm.id);
  if (i >= 0) list[i] = db;
  else list.push(db);
  activeFirmId = db.firm.id;
}

/** Start again from fresh mock data (used by "Reset demo data"). */
export function resetDb(): void {
  books = null;
  allBooks();
}

/** Wait 200–400 ms so loading states are visible, like a real network. */
export function delay(): Promise<void> {
  const ms = 200 + Math.floor(Math.random() * 200);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Return a copy so screens can never change the mock database by accident. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Real API helper (used once the services call the backend)
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return (await res.json()) as T;
}

export const http = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
};
