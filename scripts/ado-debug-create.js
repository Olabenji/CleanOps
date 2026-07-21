const fs = require("fs");
const pat = fs.readFileSync(".env_PAT.local", "utf8").trim();
const auth = "Basic " + Buffer.from(":" + pat).toString("base64");

(async () => {
  const url =
    "https://dev.azure.com/benjaminbabawale-elevatedtech/CleanOps/_apis/wit/$Task?api-version=7.1";
  console.log("URL", url);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json-patch+json"
    },
    body: JSON.stringify([{ op: "add", path: "/fields/System.Title", value: "direct probe" }])
  });

  console.log("status", res.status);
  console.log("www-auth", res.headers.get("www-authenticate"));
  console.log("tfs", res.headers.get("x-tfs-serviceerror"));
  console.log("body", await res.text());

  // Compare: can we list classification (write worked before) and create attachment?
  const iters = await fetch(
    "https://dev.azure.com/benjaminbabawale-elevatedtech/CleanOps/_apis/wit/classificationnodes/iterations?$depth=1&api-version=7.1",
    { headers: { Authorization: auth } }
  );
  console.log("iters", iters.status, (await iters.json()).children?.length);

  // Try work item type fields endpoint
  const fields = await fetch(
    "https://dev.azure.com/benjaminbabawale-elevatedtech/CleanOps/_apis/wit/workitemtypes/Task?api-version=7.1",
    { headers: { Authorization: auth } }
  );
  console.log("task type", fields.status, (await fields.text()).slice(0, 200));
})();
