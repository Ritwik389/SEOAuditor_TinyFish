// Local stand-ins for TinyFish, Gemini and a "target website". For UI development and e2e only.
// Run: npm run mock   (listens on 127.0.0.1:4010)
import { startMock } from "../tests/mock-servers";

const port = Number(process.env.MOCK_PORT ?? 4010);
const mock = await startMock(port);
mock.state.gemini.auto = true;
mock.site.set("/robots.txt", { body: "User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /pricing\n\nSitemap: __ORIGIN__/sitemap.xml" });
mock.site.set("/sitemap.xml", { type: "application/xml", body: "<urlset><url><loc>__ORIGIN__/pricing</loc></url><url><loc>__ORIGIN__/docs</loc></url></urlset>" });

// Test control plane: e2e flips behaviour per scenario. Local only.
import http from "node:http";
http
  .createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (req.url === "/__reset") {
      const { defaultMockState } = await import("../tests/mock-servers");
      Object.assign(mock.state, defaultMockState(), { gemini: { status: 200, text: "{}", auto: true } });
    } else if (req.url === "/__set") {
      for (const [k, v] of Object.entries(body)) Object.assign((mock.state as never as Record<string, object>)[k]!, v);
    } else if (req.url === "/__requests") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(mock.state.requests));
    }
    res.writeHead(204);
    res.end();
  })
  .listen(port + 1, "127.0.0.1");

console.log(`mock services on http://127.0.0.1:${port} (control: ${port + 1})`);
