// One-off helper: runs the same connection test as the Setup page against MONGODB_URI. Prints only a sanitized result.
import { testMongo } from "../src/lib/db/mongo";
const r = await testMongo();
console.log(JSON.stringify(r));
process.exit(r.ok ? 0 : 1);
