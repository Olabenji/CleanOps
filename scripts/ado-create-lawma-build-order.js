/**
 * Finish LAWMA build-order backlog under Epic #127.
 * Idempotent: skips titles that already exist with tag lawma-build-order.
 */
const fs = require("fs");
const path = require("path");

const ORG = "benjaminbabawale-elevatedtech";
const PROJECT = "CleanOps";
const API = `https://dev.azure.com/${ORG}/${PROJECT}/_apis`;
const EPIC_ID = 127;
const TAGS = "cleanops; lawma-build-order";
const pat = fs.readFileSync(path.join(__dirname, "../.env_PAT.local"), "utf8").trim();
const auth = "Basic " + Buffer.from(":" + pat).toString("base64");

const ITER = {
  p1: "CleanOps\\Sprint 12 - LAWMA P1 Evidence",
  p2: "CleanOps\\Sprint 13 - LAWMA P2 Resident",
  p25: "CleanOps\\Sprint 14 - LAWMA P2.5 Ops Analytics",
  p3: "CleanOps\\Sprint 15 - LAWMA P3 Reporting Debt",
  opt: "CleanOps\\Sprint 16 - LAWMA Optional Packs"
};

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

async function createItem(type, title, description, iteration, parentId) {
  const ops = [
    { op: "add", path: "/fields/System.Title", value: title },
    { op: "add", path: "/fields/System.Description", value: description },
    { op: "add", path: "/fields/System.AreaPath", value: PROJECT },
    { op: "add", path: "/fields/System.IterationPath", value: iteration },
    { op: "add", path: "/fields/System.Tags", value: TAGS }
  ];
  if (parentId) {
    ops.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `${API}/wit/workItems/${parentId}`
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

const tree = [
  {
    type: "Feature",
    title: "P1: Disposal evidence, complaint 24h SLA, bill delivery",
    iteration: ITER.p1,
    description:
      "<p>First build slice: prove waste went to legal weighed destinations, close citizen/facility complaints within 24h, and track bill delivery for revenue charts.</p>",
    children: [
      {
        title: "Capture weighbridge tonnage + disposal dockets on dumpsite runs",
        description:
          "<p>Extend dumpsite_runs with receipt/docket number, weighbridge tonnes (or photo of ticket), landfill site identity. Driver mobile + operator review. Aligns with LAWMA SOP Disposal rules.</p>"
      },
      {
        title: "Log illegal dump / skeletal service cases with geo + photo evidence",
        description:
          "<p>Case log for SOP offences (illegal dumping, irregular service). Link to route/stop/customer. Supports LAWMA audit defence.</p>"
      },
      {
        title: "Complaints inbox with 24-hour SLA clock and escalation",
        description:
          "<p>Operator (and later resident) complaints: missed stop, overflow, crew issue. Acknowledge/act within 24h per Service Charter/SOP. Escalation to supervisor. History + dashboard SLA metrics.</p>"
      },
      {
        title: "Bill delivery workflow with agent acknowledgement",
        description:
          "<p>Record bill period, amount, delivery status, agent delivery ack (time/GPS optional). Feeds payment chart and bill-cycle discipline from revenue SOP.</p>"
      },
      {
        title: "Vehicle branding & PPE checklist per truck/shift",
        description:
          "<p>Checklist: ward inscription, phone, colour coding, amber light, netting/tarpaulin, PPE for gang. Inspection-ready before dispatch.</p>"
      }
    ]
  },
  {
    type: "Feature",
    title: "P2: Know Your PSP + resident missed collection + self-serve pay",
    iteration: ITER.p2,
    description:
      "<p>Resident-facing accountability aligned to LAWMA Know Your PSP campaign and Charter complaint rights.</p>",
    children: [
      {
        title: "Public PSP identity card by ward/zone (name, phone, days, plates)",
        description:
          "<p>Resident portal section or shareable page: who operates this ward, contacts, preferred collection weekdays, truck contacts.</p>"
      },
      {
        title: "Resident missed-collection and service complaint submission",
        description:
          "<p>Residents report missed pickup; opens P1 complaint with SLA; optional make-good stop task.</p>"
      },
      {
        title: "Resident balance, history, and Paystack self-serve payment",
        description:
          "<p>Phase 2 resident ledger view + initiate Paystack checkout wired to existing webhook.</p>"
      },
      {
        title: "Collection schedule view for household (preferred weekdays)",
        description:
          "<p>Show residential/commercial schedule from collections_per_week + preferred_weekdays already on customers.</p>"
      }
    ]
  },
  {
    type: "Feature",
    title: "P2.5: Dumpsite status planning + due-today coverage analytics",
    iteration: ITER.p25,
    description: "<p>Ops efficiency: where to tip, who is due vs who was skipped.</p>",
    children: [
      {
        title: "Dumpsite registry with open/congested/closed status board",
        description:
          "<p>Master data for LAWMA-approved sites; status logs; operator board. Builds on dumpsite_runs.</p>"
      },
      {
        title: "Zone proximity / nearest open dumpsite recommendations",
        description: "<p>Suggest tip site per zone/route using PostGIS distance + status.</p>"
      },
      {
        title: "Due-today vs completed coverage map and skip analytics",
        description:
          "<p>Dashboard/map: due customers vs completed/skipped; skip-reason trends for skeletal-service risk.</p>"
      },
      {
        title: "Compactor utilisation vs ward capacity guidance",
        description:
          "<p>Surface fleet count vs SOP min-2-compactors-per-ward style capacity guidance.</p>"
      }
    ]
  },
  {
    type: "Feature",
    title: "P3: LAWMA monthly pack, debt ladder, markets/schools",
    iteration: ITER.p3,
    description: "<p>Institutional reporting, formal debt process, sectoral facilities.</p>",
    children: [
      {
        title: "Exportable monthly LAWMA operations pack (tonnage, coverage, complaints SLA)",
        description: "<p>One-click PDF/CSV pack for audit and monitoring officers.</p>"
      },
      {
        title: "LAWMA reporting API integration hooks",
        description:
          "<p>Phase 3 API adapter when LAWMA endpoints available; same datasets as monthly pack.</p>"
      },
      {
        title: "Demand-notice debt ladder with ageing and recalcitrant queue",
        description:
          "<p>Debt & compliance workflow: notices, verify steps, escalate to legal/enforcement handoff.</p>"
      },
      {
        title: "Per-trip commercial billing with docket + customer confirm",
        description: "<p>SOP per-trip bills require client confirmation + PSP dockets.</p>"
      },
      {
        title: "Market / school / plaza facility customer types and weekly SLA",
        description:
          "<p>Extend customer types; Charter market weekly clearance; sectoral management.</p>"
      },
      {
        title: "Commercial prospect pipeline (visit → MoU → enlistment code)",
        description:
          "<p>Business Development SOP: evaluation, 10-day enlistment, unique client ID.</p>"
      }
    ]
  },
  {
    type: "Feature",
    title: "Optional industry packs: medical, highway, recycling",
    iteration: ITER.opt,
    description:
      "<p>Only enable per tenant franchise. Medical remittance, highway photo/attendance, recyclables ledger.</p>",
    children: [
      {
        title: "Healthcare waste module (segregation, specialised vehicle, LAWMA remittance %)",
        description: "<p>Optional pack for accredited HCW operators only.</p>"
      },
      {
        title: "Highway sanitation attendance + photo proof + performance score",
        description:
          "<p>Optional pack for highway contract holders (attendance triplicate, stamped photos, ≥65% rating).</p>"
      },
      {
        title: "Recyclables diversion and buy-back ledger",
        description:
          "<p>Optional Phase 3+ revenue: sorting, material sales, resident incentives.</p>"
      }
    ]
  }
];

(async () => {
  // Close probe feature if present
  const probes = await wiql(
    `Select [System.Id] From WorkItems Where [System.TeamProject] = '${PROJECT}' AND [System.Title] = 'P1 probe' AND [System.Tags] Contains 'lawma-build-order'`
  );
  for (const p of probes) {
    try {
      await ado("PATCH", `${API}/wit/workitems/${p.id}?api-version=7.1`, JSON.stringify([
        { op: "add", path: "/fields/System.State", value: "Removed" }
      ]));
      console.log("Removed probe", p.id);
    } catch {
      console.warn("Could not remove probe", p.id);
    }
  }

  // Existing titles → ids
  const refs = await wiql(
    `Select [System.Id] From WorkItems Where [System.TeamProject] = '${PROJECT}' AND [System.Tags] Contains 'lawma-build-order'`
  );
  const existingByTitle = new Map();
  for (const ref of refs) {
    const full = await ado("GET", `${API}/wit/workitems/${ref.id}?api-version=7.1`);
    existingByTitle.set(full.fields["System.Title"], full.id);
  }

  // Point epic at Sprint 12
  await ado("PATCH", `${API}/wit/workitems/${EPIC_ID}?api-version=7.1`, JSON.stringify([
    { op: "add", path: "/fields/System.IterationPath", value: ITER.p1 }
  ]));

  let created = 0;
  let skipped = 0;
  for (const feature of tree) {
    let featureId = existingByTitle.get(feature.title);
    if (featureId) {
      console.log("Skip existing Feature:", feature.title, featureId);
      skipped++;
    } else {
      const f = await createItem("Feature", feature.title, feature.description, feature.iteration, EPIC_ID);
      featureId = f.id;
      existingByTitle.set(feature.title, featureId);
      if (feature.iteration === ITER.p1) await setActive(featureId);
      created++;
    }

    for (const story of feature.children) {
      if (existingByTitle.has(story.title)) {
        console.log("Skip existing Story:", story.title);
        skipped++;
        continue;
      }
      await createItem("User Story", story.title, story.description, feature.iteration, featureId);
      created++;
    }
  }

  console.log(`\nDone. created=${created} skipped=${skipped}`);
  console.log(`Epic: https://dev.azure.com/${ORG}/${PROJECT}/_workitems/edit/${EPIC_ID}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
