// Minimal in-memory emulation of the MongoDB collection subset Sniffsite uses.
// Only enabled with SNIFFSITE_STORE=memory outside production (tests / local UI work). Never durable.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Doc = Record<string, any>;
export type Filter = Record<string, any>;
interface Opts {
  projection?: Record<string, 0 | 1>;
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
}

export interface Coll {
  insertOne(doc: Doc): Promise<unknown>;
  insertMany(docs: Doc[]): Promise<unknown>;
  findOne(filter: Filter, opts?: Opts): Promise<Doc | null>;
  find(filter: Filter, opts?: Opts): Cursor;
  updateOne(filter: Filter, update: { $set?: Doc }, opts?: { upsert?: boolean }): Promise<{ matchedCount: number; modifiedCount: number }>;
  replaceOne(filter: Filter, doc: Doc, opts?: { upsert?: boolean }): Promise<unknown>;
  deleteOne(filter: Filter): Promise<{ deletedCount: number }>;
  deleteMany(filter: Filter): Promise<{ deletedCount: number }>;
  countDocuments(filter: Filter): Promise<number>;
  createIndex(spec: Record<string, 1 | -1>, opts?: Record<string, unknown>): Promise<unknown>;
  dropIndex(name: string): Promise<unknown>;
}
export interface Cursor {
  sort(s: Record<string, 1 | -1>): Cursor;
  skip(n: number): Cursor;
  limit(n: number): Cursor;
  project(p: Record<string, 0 | 1>): Cursor;
  toArray(): Promise<Doc[]>;
}
export interface Db {
  collection(name: string): Coll;
}

function get(doc: Doc, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);
}

function matches(doc: Doc, filter: Filter): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === "$or") return (cond as Filter[]).some((f) => matches(doc, f));
    if (k === "$and") return (cond as Filter[]).every((f) => matches(doc, f));
    const v = get(doc, k);
    if (cond && typeof cond === "object" && !(cond instanceof RegExp) && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, arg]) => {
        switch (op) {
          case "$in": return (arg as any[]).includes(v);
          case "$gte": return v >= (arg as any);
          case "$lte": return v <= (arg as any);
          case "$lt": return v < (arg as any);
          case "$gt": return v > (arg as any);
          case "$ne": return v !== arg;
          case "$regex": return typeof v === "string" && new RegExp(arg as string, (cond as any).$options ?? "").test(v);
          case "$options": return true;
          default: throw new Error(`memory store: unsupported operator ${op}`);
        }
      });
    }
    if (cond instanceof RegExp) return typeof v === "string" && cond.test(v);
    return v === cond;
  });
}

function project(doc: Doc, p?: Record<string, 0 | 1>): Doc {
  const c = structuredClone(doc);
  if (!p) return c;
  for (const [k, v] of Object.entries(p)) if (v === 0) delete c[k];
  return c;
}

class MemColl implements Coll {
  docs: Doc[] = [];
  async insertOne(doc: Doc) { this.docs.push(structuredClone(doc)); return {}; }
  async insertMany(docs: Doc[]) { docs.forEach((d) => this.docs.push(structuredClone(d))); return {}; }
  async findOne(filter: Filter, opts?: Opts) {
    const d = this.docs.find((x) => matches(x, filter));
    return d ? project(d, opts?.projection) : null;
  }
  find(filter: Filter, opts: Opts = {}): Cursor {
    const state: Opts = { ...opts };
    const cur: Cursor = {
      sort: (s) => ((state.sort = s), cur),
      skip: (n) => ((state.skip = n), cur),
      limit: (n) => ((state.limit = n), cur),
      project: (p) => ((state.projection = p), cur),
      toArray: async () => {
        let out = this.docs.filter((x) => matches(x, filter));
        if (state.sort) {
          const [[field, dir]] = Object.entries(state.sort) as [[string, 1 | -1]];
          out = [...out].sort((a, b) => (get(a, field) > get(b, field) ? 1 : get(a, field) < get(b, field) ? -1 : 0) * dir);
        }
        out = out.slice(state.skip ?? 0, state.limit ? (state.skip ?? 0) + state.limit : undefined);
        return out.map((d) => project(d, state.projection));
      },
    };
    return cur;
  }
  async updateOne(filter: Filter, update: { $set?: Doc }, opts?: { upsert?: boolean }) {
    let d = this.docs.find((x) => matches(x, filter));
    const created = !d;
    if (!d) {
      if (!opts?.upsert) return { matchedCount: 0, modifiedCount: 0 };
      d = {};
      for (const [k, v] of Object.entries(filter)) if (typeof v !== "object") d[k] = v;
      this.docs.push(d);
    }
    for (const [k, v] of Object.entries(update.$set ?? {})) {
      const parts = k.split(".");
      let o: Doc = d;
      for (const p of parts.slice(0, -1)) o = o[p] ??= {};
      o[parts.at(-1)!] = structuredClone(v);
    }
    return { matchedCount: created ? 0 : 1, modifiedCount: 1 };
  }
  async replaceOne(filter: Filter, doc: Doc, opts?: { upsert?: boolean }) {
    const i = this.docs.findIndex((x) => matches(x, filter));
    if (i >= 0) this.docs[i] = structuredClone(doc);
    else if (opts?.upsert) this.docs.push(structuredClone(doc));
    return {};
  }
  async deleteOne(filter: Filter) {
    const i = this.docs.findIndex((x) => matches(x, filter));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }
  async deleteMany(filter: Filter) {
    const before = this.docs.length;
    this.docs = this.docs.filter((x) => !matches(x, filter));
    return { deletedCount: before - this.docs.length };
  }
  async countDocuments(filter: Filter) { return this.docs.filter((x) => matches(x, filter)).length; }
  async createIndex() { return "memory"; }
  async dropIndex() { return {}; }
}

export class MemoryDb implements Db {
  private cols = new Map<string, MemColl>();
  collection(name: string): Coll {
    let c = this.cols.get(name);
    if (!c) this.cols.set(name, (c = new MemColl()));
    return c;
  }
}
