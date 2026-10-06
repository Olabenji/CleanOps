/**
 * List open CleanOps work items (for status sync).
 */
const fs = require("fs");
const path = require("path");

const ORG = "benjaminbabawale-elevatedtech";
const PROJECT = "CleanOps";
const API = `https://dev.azure.com/${ORG}/${PROJECT}/_apis`;
const pat = fs.readFileSync(path.join(__dirname, "../.env_PAT.local"), "utf8").trim();
const auth = "Basic " + Buffer.from(":" + pat).toString("base64");

async function ado(method, url, body, contentType = "application/json") {
  const headers = { Authorization: auth, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = contentType;
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const data = await ado(
    "POST",
    `${API}/wit/wiql?api-version=7.1`,
    JSON.stringify({
      query: `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType]
FROM WorkItems
WHERE [System.TeamProject] = '${PROJECT}'
  AND [System.State] <> 'Closed'
  AND [System.State] <> 'Removed'
ORDER BY [System.Id]`
    })
  );
  const ids = (data.workItems || []).map((w) => w.id);
  console.log("open_count", ids.length);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const batch = await ado(
      "GET",
      `${API}/wit/workitems?ids=${chunk.join(",")}&fields=System.Id,System.Title,System.State,System.WorkItemType,System.Tags&api-version=7.1`
    );
    for (const w of batch.value || []) {
      console.log(
        [w.id, w.fields["System.WorkItemType"], w.fields["System.State"], w.fields["System.Title"]].join("\t")
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
