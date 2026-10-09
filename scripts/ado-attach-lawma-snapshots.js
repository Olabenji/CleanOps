/**
 * Attach LAWMA frequency UI snapshots + history to work item #50.
 */
const fs = require("fs");
const path = require("path");

const ORG = "benjaminbabawale-elevatedtech";
const PROJECT = "CleanOps";
const API = `https://dev.azure.com/${ORG}/${PROJECT}/_apis`;
const WI = 50;

const files = [
  "docs/ado-snapshots/11-admin-customers-frequency.png",
  "docs/ado-snapshots/12-admin-customer-frequency-edit.png"
];

const existing = files.filter((relative) => fs.existsSync(path.join(__dirname, "..", relative)));
if (existing.length === 0) {
  console.warn(
    "No LAWMA frequency snapshots to attach. Those images were removed because they showed a real operator brand."
  );
  process.exit(0);
}

const pat = (process.env.AZURE_DEVOPS_EXT_PAT || fs.readFileSync(path.join(__dirname, "../.env_PAT.local"), "utf8")).trim();
const auth = "Basic " + Buffer.from(":" + pat).toString("base64");

async function ado(method, url, body, contentType) {
  const headers = { Authorization: auth };
  if (contentType) headers["Content-Type"] = contentType;
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

(async () => {
  const attachments = [];
  for (const relative of existing) {
    const full = path.join(__dirname, "..", relative);
    const uploaded = await ado(
      "POST",
      `${API}/wit/attachments?fileName=${encodeURIComponent(path.basename(full))}&api-version=7.1`,
      fs.readFileSync(full),
      "application/octet-stream"
    );
    attachments.push({ file: path.basename(full), url: uploaded.url });
    console.log("uploaded", path.basename(full));
  }

  const imgHtml = attachments
    .map(
      (a) =>
        `<div style="margin:12px 0"><div><i>${a.file}</i></div><img src="${a.url}" alt="${a.file}" style="max-width:900px;border:1px solid #ddd;border-radius:8px"/></div>`
    )
    .join("");

  const history = `<p><b>Verified build snapshot (14 Jul 2026).</b> Admin Customers list shows LAWMA frequency (e.g. Tasty Bites 3×/week · Mon,Wed,Fri). Edit modal exposes collections/week, preferred weekdays, and frequency notes. Tests: typecheck + Vitest 10/10 + lint passed. Commit <code>8cc7234</code>.</p>${imgHtml}`;

  const ops = [{ op: "add", path: "/fields/System.History", value: history }];
  for (const a of attachments) {
    ops.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "AttachedFile",
        url: a.url,
        attributes: { comment: `UI snapshot: ${a.file}` }
      }
    });
  }

  await ado(
    "PATCH",
    `${API}/wit/workitems/${WI}?api-version=7.1`,
    JSON.stringify(ops),
    "application/json-patch+json"
  );
  console.log("patched WI", WI);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
