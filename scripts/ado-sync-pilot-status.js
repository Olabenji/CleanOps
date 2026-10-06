/**
 * Sync pilot-ready status to Azure DevOps (Epic #127 + related items).
 *
 * - Adds a HTML discussion comment on Epic #127
 * - Closes known-done work items when still open (by id)
 * - Ensures Active pilot-gate stories exist (create if missing by title)
 *
 * Requires a valid PAT in .env_PAT.local (Work Items read/write).
 * Run: node scripts/ado-sync-pilot-status.js
 */
const fs = require("fs");
const path = require("path");

const ORG = "benjaminbabawale-elevatedtech";
const PROJECT = "CleanOps";
const API = `https://dev.azure.com/${ORG}/${PROJECT}/_apis`;
const EPIC_ID = 127;
const TAGS = "cleanops; pilot-status; lawma-build-order";
const pat = fs.readFileSync(path.join(__dirname, "../.env_PAT.local"), "utf8").trim();
const auth = "Basic " + Buffer.from(":" + pat).toString("base64");

const CLOSE_IDS = [
  143, // coverage list
  166, // frequency + make-good feature (if still open)
  167,
  168,
  169,
  170
];

const PILOT_GATE_STORIES = [
  {
    title: "Pilot gate: Termii + Twilio secrets and live OTP/Comms QA",
    description:
      "<p>Set hosted TERMII_API_KEY (and Twilio WhatsApp secrets). Complete phone OTP walkthrough (DEV_REVEAL or real SMS) per docs/phone-otp-auth.md. Unblocks live SMS/WhatsApp for Comms.</p>"
  },
  {
    title: "Pilot gate: Hosted migrate through 0080 (truck live GPS)",
    description:
      "<p>Confirm hosted project includes 0080_truck_live_gps.sql; db push if missing. Fleet map should prefer live driver pings ≤15 min.</p>"
  },
  {
    title: "Pilot gate: First design-partner ward on hosted",
    description:
      "<p>One PSP, one ward, ~3 trucks, full staff. Ward-day path: plan routes → driver stops + proof → close incomplete → resident inbox/push → agent/Paystack. Use Growth packaging; meter WhatsApp/SMS.</p>"
  },
  {
    title: "Pilot gate: Commit/push local sync + optional gh CI visibility",
    description:
      "<p>Commit uncommitted local work (banner/OTP/GPS/docs) so origin matches pilot machine. Optional: gh auth login to inspect quality-gate Actions.</p>"
  }
];

const STATUS_HTML = `
<p><b>CleanOps progress sync — 19 September 2026</b></p>
<p>Verdict: <b>pilot-ready / near production</b>. Phase 1 + most of Phase 2 shipped. Hosted through 0079 (+ Edge redeployed); local includes 0080. Go-live = one PSP ward on hosted, not more features.</p>
<p><b>Progress</b></p>
<ul>
<li>Operator web: Dashboard, Routes, Payments, Staff, Coverage, Compliance, Fleet, Reports, Comms, Settings, Admin</li>
<li>Mobile: driver (proof + live GPS) + agent + resident (Paystack, inbox); Android push E2E done</li>
<li>Quality: local quality-gate green; phone OTP code shipped (live SMS parked on Termii)</li>
</ul>
<p><b>Left (do first)</b></p>
<ol>
<li>Termii (+ Twilio) secrets → OTP/Comms QA</li>
<li>Confirm hosted 0080</li>
<li>Commit/push local sync</li>
<li>Optional gh auth for remote CI; Sentry/env hardening</li>
<li>First design-partner ward pilot (meter WhatsApp/SMS)</li>
</ol>
<p>Repo docs: <code>docs/progress-snapshot.md</code>, <code>docs/agent-handover.md</code>, <code>docs/roadmap.md</code>.</p>
`.trim();

async function ado(method, url, body, contentType = "application/json-patch+json") {
  const headers = { Authorization: auth, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = contentType;
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}

async function getWi(id) {
  try {
    return await ado("GET", `${API}/wit/workitems/${id}?api-version=7.1`, undefined, "application/json");
  } catch (e) {
    if (String(e.message).includes("404")) return null;
    throw e;
  }
}

async function closeIfOpen(id) {
  const wi = await getWi(id);
  if (!wi) {
    console.log(`skip #${id} (not found)`);
    return;
  }
  const state = wi.fields["System.State"];
  if (state === "Closed" || state === "Removed") {
    console.log(`#${id} already ${state}: ${wi.fields["System.Title"]}`);
    return;
  }
  await ado("PATCH", `${API}/wit/workitems/${id}?api-version=7.1`, JSON.stringify([
    { op: "add", path: "/fields/System.State", value: "Closed" },
    {
      op: "add",
      path: "/fields/System.History",
      value:
        "Closed via ado-sync-pilot-status.js (19 Sep 2026): delivered in CleanOps pilot-ready build. See docs/progress-snapshot.md."
    }
  ]));
  console.log(`Closed #${id}: ${wi.fields["System.Title"]}`);
}

async function findByTitle(title) {
  const data = await ado(
    "POST",
    `${API}/wit/wiql?api-version=7.1`,
    JSON.stringify({
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${PROJECT}' AND [System.Title] = '${title.replace(/'/g, "''")}'`
    }),
    "application/json"
  );
  return (data.workItems || [])[0]?.id || null;
}

async function ensureStory(story) {
  const existing = await findByTitle(story.title);
  if (existing) {
    const wi = await getWi(existing);
    console.log(`exists #${existing} [${wi.fields["System.State"]}]: ${story.title}`);
    if (wi.fields["System.State"] === "New") {
      await ado("PATCH", `${API}/wit/workitems/${existing}?api-version=7.1`, JSON.stringify([
        { op: "add", path: "/fields/System.State", value: "Active" }
      ]));
      console.log(`  -> Active`);
    }
    return existing;
  }
  const ops = [
    { op: "add", path: "/fields/System.Title", value: story.title },
    { op: "add", path: "/fields/System.Description", value: story.description },
    { op: "add", path: "/fields/System.AreaPath", value: PROJECT },
    { op: "add", path: "/fields/System.Tags", value: TAGS },
    { op: "add", path: "/fields/System.State", value: "Active" },
    {
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `https://dev.azure.com/${ORG}/${PROJECT}/_apis/wit/workItems/${EPIC_ID}`
      }
    }
  ];
  const item = await ado(
    "POST",
    `${API}/wit/workitems/$User%20Story?api-version=7.1`,
    JSON.stringify(ops)
  );
  console.log(`Created User Story #${item.id}: ${story.title}`);
  return item.id;
}

async function commentEpic() {
  // Discussion via System.History patch (works across orgs without discussions API quirks)
  await ado("PATCH", `${API}/wit/workitems/${EPIC_ID}?api-version=7.1`, JSON.stringify([
    { op: "add", path: "/fields/System.History", value: STATUS_HTML },
    { op: "add", path: "/fields/System.State", value: "Active" }
  ]));
  console.log(`Epic #${EPIC_ID} history updated + Active`);
}

async function main() {
  const probe = await getWi(EPIC_ID);
  if (!probe) throw new Error(`Cannot read Epic #${EPIC_ID} — check PAT scopes / expiry`);
  console.log(`Epic #${EPIC_ID}: ${probe.fields["System.Title"]} [${probe.fields["System.State"]}]`);

  await commentEpic();

  for (const id of CLOSE_IDS) {
    try {
      await closeIfOpen(id);
    } catch (e) {
      console.warn(`close #${id}:`, e.message.slice(0, 200));
    }
  }

  for (const story of PILOT_GATE_STORIES) {
    await ensureStory(story);
  }

  console.log(`\nEpic: https://dev.azure.com/${ORG}/${PROJECT}/_workitems/edit/${EPIC_ID}`);
  console.log("Docs: docs/progress-snapshot.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
