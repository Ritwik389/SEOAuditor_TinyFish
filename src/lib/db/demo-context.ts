import { AsyncLocalStorage } from "node:async_hooks";
import { MemoryDb } from "./memory";

// One isolated workspace per streamed request. No public reports are kept in a
// shared serverless process; the requesting browser saves the returned report.
const context = new AsyncLocalStorage<MemoryDb>();
export const demoDb = () => context.getStore();
export const withDemoDb = <T>(work: () => T): T => context.run(new MemoryDb(), work);
