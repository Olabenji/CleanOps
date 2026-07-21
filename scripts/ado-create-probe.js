const fs = require("fs");
const pat = fs.readFileSync(".env_PAT.local", "utf8").trim();
const auth = "Basic " + Buffer.from(":" + pat).toString("base64");

async function create(proj, type) {
  const url =
    "https://dev.azure.com/benjaminbabawale-elevatedtech/" +
    encodeURIComponent(proj) +
    "/_apis/wit/$" +
    encodeURIComponent(type) +
    "?api-version=7.1";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json-patch+json"
    },
    body: JSON.stringify([
      { op: "add", path: "/fields/System.Title", value: `probe ${proj} ${type}` },
      { op: "add", path: "/fields/System.AreaPath", value: proj }
    ])
  });
  const text = await res.text();
  return { status: res.status, text };
}

(async () => {
  const projects = await (
    await fetch("https://dev.azure.com/benjaminbabawale-elevatedtech/_apis/projects?api-version=7.1", {
      headers: { Authorization: auth }
    })
  ).json();
  console.log(
    "projects:",
    projects.value.map((p) => p.name).join(", ")
  );

  const wiqlRes = await fetch(
    "https://dev.azure.com/benjaminbabawale-elevatedtech/CleanOps/_apis/wit/wiql?api-version=7.1",
    {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        query:
          "Select [System.Id] From WorkItems WHERE [System.TeamProject] = 'CleanOps'"
      })
    }
  );
  const wiql = await wiqlRes.json();
  console.log("CleanOps WI count", wiql.workItems?.length ?? 0);

  for (const proj of ["CleanOps", "AT_Home Solutions"]) {
    for (const type of ["Task", "Issue", "Product Backlog Item", "User Story", "Bug"]) {
      const result = await create(proj, type);
      console.log(result.status, proj, type, result.text.slice(0, 180).replace(/\n/g, " "));
      if (result.status >= 200 && result.status < 300) {
        const id = JSON.parse(result.text).id;
        await fetch(
          "https://dev.azure.com/benjaminbabawale-elevatedtech/" +
            encodeURIComponent(proj) +
            "/_apis/wit/workitems/" +
            id +
            "?api-version=7.1",
          { method: "DELETE", headers: { Authorization: auth } }
        );
        console.log("SUCCESS deleted probe", id);
        process.exit(0);
      }
    }
  }
})();
