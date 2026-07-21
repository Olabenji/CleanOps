const fs = require("fs");
const pat = fs.readFileSync(".env_PAT.local", "utf8").trim();
fetch(
  "https://dev.azure.com/benjaminbabawale-elevatedtech/CleanOps/_apis/wit/workitems/50?api-version=7.1&$expand=relations",
  { headers: { Authorization: "Basic " + Buffer.from(":" + pat).toString("base64") } }
)
  .then(async (r) => {
    const t = await r.text();
    if (!r.ok) throw new Error(r.status + " " + t.slice(0, 300));
    const w = JSON.parse(t);
    console.log(
      JSON.stringify(
        {
          id: w.id,
          title: w.fields["System.Title"],
          state: w.fields["System.State"],
          attachments: (w.relations || []).filter((x) => x.rel === "AttachedFile").length,
          url: "https://dev.azure.com/benjaminbabawale-elevatedtech/CleanOps/_workitems/edit/" + w.id
        },
        null,
        2
      )
    );
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
