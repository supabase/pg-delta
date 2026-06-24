#!/usr/bin/env bun
/** Usage: bun scripts/md-to-html.ts docs/old-vs-north-star.md */

const input = process.argv[2];
if (!input) {
  console.error("Usage: bun scripts/md-to-html.ts <file.md>");
  process.exit(1);
}

const md = await Bun.file(input).text();
const title = input.split("/").pop()?.replace(/\.md$/, "") ?? "Document";
const out = input.replace(/\.md$/, "") + ".html";
const payload = JSON.stringify(md).replace(/<\//g, "\\u003c/");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { max-width: 52rem; margin: 2rem auto; padding: 0 1rem; font: 16px/1.6 system-ui, sans-serif; color: #1a1a1a; }
    h1,h2,h3 { line-height: 1.25; }
    a { color: #0969da; }
    code, pre { font-family: ui-monospace, monospace; font-size: 0.9em; }
    pre { background: #f6f8fa; padding: 1rem; overflow-x: auto; border-radius: 6px; }
    :not(pre) > code { background: #f6f8fa; padding: 0.15em 0.35em; border-radius: 4px; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #d0d7de; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #f6f8fa; }
    blockquote { border-left: 4px solid #d0d7de; margin: 0; padding-left: 1rem; color: #57606a; }
    .mermaid { margin: 1.5rem 0; text-align: center; }
    hr { border: none; border-top: 1px solid #d0d7de; margin: 2rem 0; }
  </style>
</head>
<body>
  <div id="content"></div>
  <script id="source" type="application/json">${payload}</script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({ startOnLoad: false, theme: "neutral" });
    const src = JSON.parse(document.getElementById("source").textContent);
    const renderer = new marked.Renderer();
    renderer.code = ({ text, lang }) =>
      lang === "mermaid"
        ? \`<pre class="mermaid">\${text}</pre>\`
        : \`<pre><code class="language-\${lang ?? ""}">\${text}</code></pre>\`;
    document.getElementById("content").innerHTML = marked.parse(src, { renderer });
    await mermaid.run({ querySelector: ".mermaid" });
  </script>
</body>
</html>`;

await Bun.write(out, html);
console.log(`Wrote ${out}`);
