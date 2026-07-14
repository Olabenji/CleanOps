/**
 * Upload UI snapshots + brief descriptions to CleanOps historical-sync work items.
 * Uses AZURE_DEVOPS_EXT_PAT or .env_PAT.local
 */
const fs = require("fs");
const path = require("path");

const ORG = "benjaminbabawale-elevatedtech";
const PROJECT = "CleanOps";
const API = `https://dev.azure.com/${ORG}/${PROJECT}/_apis`;
const SNAP_DIR = path.join(__dirname, "../docs/ado-snapshots");

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

async function uploadAttachment(filePath, fileName) {
  const bytes = fs.readFileSync(filePath);
  const url = `${API}/wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=7.1`;
  return ado("POST", url, bytes, "application/octet-stream");
}

async function patchWorkItem(id, ops) {
  return ado("PATCH", `${API}/wit/workitems/${id}?api-version=7.1`, JSON.stringify(ops), "application/json-patch+json");
}

function snap(name) {
  return path.join(SNAP_DIR, name);
}

/**
 * Each entry: work item ids, screenshot files, brief description HTML (without img tags).
 * Screenshots are attached and referenced in System.History.
 */
const updates = [
  {
    ids: [7],
    files: ["01-dashboard.png", "07-platform-admin.png", "10-mobile-driver-stops.png"],
    blurb:
      "<p><b>Phase 1 deliverable snapshot.</b> Operator web command centre (dashboard/routes/payments/staff/admin), platform tenant console, and driver mobile field workflows. Local pilot tenant: Next to Godliness; second tenant Island Clean for multi-tenant isolation.</p>"
  },
  {
    ids: [8, 9, 10],
    files: ["00-login.png", "01-dashboard.png"],
    blurb:
      "<p><b>Foundation.</b> Monorepo + Supabase schema/RLS/seed data power the signed-in operator workspace. Login admits seeded owner credentials into the tenant-scoped command centre.</p>"
  },
  {
    ids: [11, 12, 13],
    files: ["04-agent-collections.png", "09-mobile-signin.png"],
    blurb:
      "<p><b>Sprint 1 — Collection agent.</b> Field agents sign into CleanOps Field and record payments; operators reconcile totals on Payments → Agent collections.</p>"
  },
  {
    ids: [14],
    files: ["04-agent-collections.png", "03-payments.png"],
    blurb:
      "<p><b>Operator agent reconciliation.</b> Agent collections tab shows per-agent cash totals for the operations date beside the customer ledger.</p>"
  },
  {
    ids: [15, 16, 17],
    files: ["06-admin.png"],
    blurb:
      "<p><b>Sprint 2 — Staff auth from Admin.</b> Drivers &amp; Staff master data supports Create login / Send reset email, login email on cards, and licence badges for drivers.</p>"
  },
  {
    ids: [18],
    files: ["09-mobile-signin.png"],
    blurb:
      "<p><b>Mobile credential sign-in.</b> Provisioned staff use Admin-issued email/password on CleanOps Field (demo and live Supabase modes).</p>"
  },
  {
    ids: [19, 20, 21],
    files: ["03-payments.png"],
    blurb:
      "<p><b>Sprint 3 — Paystack webhook.</b> Verified charge.success posts into the shared payments ledger; operator Payments UI refreshes ledger balances after online collections.</p>"
  },
  {
    ids: [22, 23, 24],
    files: ["10-mobile-driver-stops.png", "08-mobile-driver-wrapup.png"],
    blurb:
      "<p><b>Sprint 4 — Driver field logs.</b> Driver mobile route stops and shift wrap-up surfaces back fuel/dumpsite field activity against the assigned route.</p>"
  },
  {
    ids: [25, 26],
    files: ["02-routes.png"],
    blurb:
      "<p><b>Sprint 5 — Truck handoffs (operator).</b> Route operations lists today's zone runs with truck/driver assignment; reassignment/handoff controls live on this Routes workspace.</p>"
  },
  {
    ids: [27, 28],
    files: ["08-mobile-driver-wrapup.png", "10-mobile-driver-stops.png"],
    blurb:
      "<p><b>Sprint 5 — Driver cover / handoff mobile.</b> Drivers see cover completions and assignment state on shift wrap-up after confirming operator-initiated handoffs.</p>"
  },
  {
    ids: [29, 30],
    files: ["02-routes.png", "06-admin.png"],
    blurb:
      "<p><b>Sprint 6 — Floating trucks.</b> Routes planner can assign any operational truck across zones; Admin truck records keep home zone optional rather than hard-bound.</p>"
  },
  {
    ids: [31, 32, 33],
    files: ["02-routes.png"],
    blurb:
      "<p><b>Sprint 7 — Zone templates &amp; auto-load.</b> Routes page loads daily plans from zone templates (Plan selected date from zone templates) and preserves editable scheduled runs.</p>"
  },
  {
    ids: [34],
    files: ["10-mobile-driver-stops.png"],
    blurb:
      "<p><b>Driver route-change notices.</b> Drivers receive in-app notice of operator plan edits on their assigned mobile route for the day.</p>"
  },
  {
    ids: [35, 36],
    files: ["06-admin.png"],
    blurb:
      "<p><b>Sprint 8 — Admin edit flows.</b> Master data cards expose Edit for staff (also trucks/customers tabs), plus deactivate without deleting history.</p>"
  },
  {
    ids: [37, 38],
    files: ["06-admin.png"],
    blurb:
      "<p><b>Sprint 9 — Licence vault UI.</b> Driver cards show licence thumbnail, expiry, and Upload licence beside login controls.</p>"
  },
  {
    ids: [39],
    files: ["00-login.png", "01-dashboard.png"],
    blurb:
      "<p><b>Self-service profiles.</b> Signed-in owners land in the branded operator shell; profile/session identity appears in the sidebar (e.g. Lanre · owner).</p>"
  },
  {
    ids: [40],
    files: ["00-login.png", "01-dashboard.png", "02-routes.png"],
    blurb:
      "<p><b>SaaS operator UI redesign.</b> Mint shell, sidebar brand, KPI cards, and calmer controls across Dashboard and Routes.</p>"
  },
  {
    ids: [41, 42, 43],
    files: ["07-platform-admin.png"],
    blurb:
      "<p><b>Sprint 10 — Platform admin.</b> Platform console lists tenants (Next to Godliness, Island Clean) with plan/status and Onboard / Suspend actions.</p>"
  },
  {
    ids: [44],
    files: ["01-dashboard.png", "07-platform-admin.png"],
    blurb:
      "<p><b>Tenant isolation fix.</b> Live sessions no longer fall back to pilot fixtures; each operator (and empty tenants like Island Clean) only see their own data after grants restore.</p>"
  },
  {
    ids: [45],
    files: ["01-dashboard.png", "06-admin.png"],
    blurb:
      "<p><b>API table grants restore.</b> After migration 0047 restored authenticated SELECT/DML, Next to Godliness dashboard and Admin staff lists load live tenant rows again.</p>"
  },
  {
    ids: [46, 47, 48, 49],
    files: ["01-dashboard.png"],
    blurb:
      "<p><b>Sprint 11 — Quality gate (planned).</b> Next work: CI typecheck/migration lint, operator smoke tests, and Android device QA for driver/agent offline sync. Dashboard screenshot is the baseline surface under test.</p>"
  }
];

(async () => {
  let ok = 0;
  let fail = 0;
  for (const batch of updates) {
    const attachments = [];
    for (const file of batch.files) {
      const full = snap(file);
      if (!fs.existsSync(full)) {
        console.warn("Missing file", file);
        continue;
      }
      const uploaded = await uploadAttachment(full, file);
      attachments.push({ file, url: uploaded.url });
      console.log("uploaded", file, uploaded.id || uploaded.url);
    }

    const imgHtml = attachments
      .map(
        (a) =>
          `<div style="margin:12px 0"><div><i>${a.file}</i></div><img src="${a.url}" alt="${a.file}" style="max-width:900px;border:1px solid #ddd;border-radius:8px"/></div>`
      )
      .join("");
    const historyHtml = `${batch.blurb}${imgHtml}<p><i>Attached ${attachments.length} UI snapshot(s) for historical backlog review.</i></p>`;

    for (const id of batch.ids) {
      try {
        const ops = [
          {
            op: "add",
            path: "/fields/System.History",
            value: historyHtml
          }
        ];
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
        await patchWorkItem(id, ops);
        console.log("updated WI", id);
        ok++;
      } catch (err) {
        console.error("FAILED WI", id, err.message);
        fail++;
      }
    }
  }
  console.log(`\nDone. ok=${ok} fail=${fail}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
