#!/usr/bin/env node
/**
 * Sprint 14: Frequency-aware routing + make-good under Epic #127.
 * Also retargets #143; leaves #142/#144 in Sprint 14 but they may be deferred.
 */
const fs = require("fs");
const path = require("path");

const ORG = "benjaminbabawale-elevatedtech";
const PROJECT = "CleanOps";
const API = `https://dev.azure.com/${ORG}/${PROJECT}/_apis`;
const EPIC_ID = 127;
const FEATURE_140 = 140;
const STORY_143 = 143;
const TAGS = "cleanops; frequency-make-good";
const ITER = "CleanOps\\Sprint 14 - LAWMA P2.5 Ops Analytics";
const pat = fs.readFileSync(path.join(__dirname, "../.env_PAT.local"), "utf8").trim();
const auth = "Basic " + Buffer.from(":" + pat).toString("base64");

async function ado(method, url, body, contentType = "application/json-patch+json") {
  const headers = { Authorization: auth, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = contentType;
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function wiql(query) {
  const data = await ado(
    "POST",
    `${API}/wit/wiql?api-version=7.1`,
    JSON.stringify({ query }),
    "application/json"
  );
  return data.workItems || [];
}

async function findByTitle(title) {
  const items = await wiql(
    `Select [System.Id] From WorkItems Where [System.TeamProject] = '${PROJECT}' AND [System.Title] = '${title.replace(/'/g, "''")}' AND [System.Tags] Contains 'frequency-make-good'`
  );
  return items[0]?.id ?? null;
}

async function createItem(type, title, description, parentId) {
  const existing = await findByTitle(title);
  if (existing) {
    console.log(`Skip existing ${type} #${existing}: ${title}`);
    return { id: existing };
  }

  const ops = [
    { op: "add", path: "/fields/System.Title", value: title },
    { op: "add", path: "/fields/System.Description", value: description },
    { op: "add", path: "/fields/System.AreaPath", value: PROJECT },
    { op: "add", path: "/fields/System.IterationPath", value: ITER },
    { op: "add", path: "/fields/System.Tags", value: TAGS }
  ];
  if (parentId) {
    ops.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `https://dev.azure.com/${ORG}/${PROJECT}/_apis/wit/workItems/${parentId}`
      }
    });
  }
  const item = await ado(
    "POST",
    `${API}/wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`,
    JSON.stringify(ops)
  );
  console.log(`${type} #${item.id}: ${title}`);
  return item;
}

async function setActive(id) {
  await ado("PATCH", `${API}/wit/workitems/${id}?api-version=7.1`, JSON.stringify([
    { op: "add", path: "/fields/System.State", value: "Active" }
  ]));
}

async function main() {
  const feature = await createItem(
    "Feature",
    "Frequency-aware routing + make-good carryover",
    "<p>Plan only preferred-weekday customers; carry missed due stops as make-good until completed. Dashboard alerts + resident subsequent-collection note. Core of Sprint 14 frequency work.</p>",
    EPIC_ID
  );
  await setActive(feature.id);

  const stories = [
    {
      title: "Filter plan_daily_routes by preferred weekdays",
      description:
        "<p>When planning a date, include active customers whose preferred_weekdays match the ops ISO DOW (plus make-good customers from story B). Mark is_make_good on stops.</p>"
    },
    {
      title: "Make-good queue enqueue/clear + include in next plans",
      description:
        "<p>collection_make_goods table; enqueue on skipped/missed_reported for due or already make-good stops; clear on completed; include open/scheduled in subsequent plan_daily_routes until serviced.</p>"
    },
    {
      title: "Dashboard alerts for open and overdue make-goods",
      description:
        "<p>Extend operator_dashboard_snapshot alerts for open make-goods and those past due_by (frequency SLA window).</p>"
    },
    {
      title: "Resident subsequent-collection note on home",
      description:
        "<p>get_resident_home exposes makeGood; ResidentApp schedule card notes that a subsequent collection is being planned with target due_by.</p>"
    }
  ];

  for (const story of stories) {
    await createItem("User Story", story.title, story.description, feature.id);
  }

  // Retarget #143
  await ado("PATCH", `${API}/wit/workitems/${STORY_143}?api-version=7.1`, JSON.stringify([
    {
      op: "replace",
      path: "/fields/System.Title",
      value: "Coverage list: due today vs completed vs make-good (no map yet)"
    },
    {
      op: "add",
      path: "/fields/System.Description",
      value:
        "<p>Slimmed for Sprint 14: list/report of due-today vs completed vs open make-good using frequency + make-good model. Map and skip-reason trends deferred to Sprint 15.</p>"
    },
    { op: "add", path: "/fields/System.Tags", value: "cleanops; lawma-build-order; frequency-make-good" }
  ]));
  console.log(`Updated #${STORY_143} title/description`);

  // Keep #140 Active if New
  try {
    await setActive(FEATURE_140);
    console.log(`Feature #${FEATURE_140} -> Active`);
  } catch (e) {
    console.warn(`Feature #${FEATURE_140} state:`, e.message.slice(0, 120));
  }

  console.log(`\nFeature: https://dev.azure.com/${ORG}/${PROJECT}/_workitems/edit/${feature.id}`);
  console.log(`Epic: https://dev.azure.com/${ORG}/${PROJECT}/_workitems/edit/${EPIC_ID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
