/**
 * Auth backlog under Epic #127: self-serve forgot-password + resident customer Auth.
 * Idempotent on title + tag auth-login-backlog.
 */
const fs = require("fs");
const path = require("path");

const ORG = "benjaminbabawale-elevatedtech";
const PROJECT = "CleanOps";
const API = `https://dev.azure.com/${ORG}/${PROJECT}/_apis`;
const EPIC_ID = 127;
const TAGS = "cleanops; auth-login-backlog";
const pat = fs.readFileSync(path.join(__dirname, "../.env_PAT.local"), "utf8").trim();
const auth = "Basic " + Buffer.from(":" + pat).toString("base64");

const ITER = {
  p1: "CleanOps\\Sprint 12 - LAWMA P1 Evidence",
  p2: "CleanOps\\Sprint 13 - LAWMA P2 Resident"
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

async function findByTitle(title) {
  const items = await wiql(
    `Select [System.Id] From WorkItems Where [System.TeamProject] = '${PROJECT}' AND [System.Title] = '${title.replace(/'/g, "''")}' AND [System.Tags] Contains 'auth-login-backlog'`
  );
  return items[0]?.id ?? null;
}

async function createItem(type, title, description, iteration, parentId) {
  const existing = await findByTitle(title);
  if (existing) {
    console.log(`Skip existing ${type} #${existing}: ${title}`);
    return { id: existing };
  }

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

async function addPredecessor(successorId, predecessorId) {
  try {
    await ado("PATCH", `${API}/wit/workitems/${successorId}?api-version=7.1`, JSON.stringify([
      {
        op: "add",
        path: "/relations/-",
        value: {
          rel: "System.LinkTypes.Dependency-Reverse",
          url: `https://dev.azure.com/${ORG}/${PROJECT}/_apis/wit/workItems/${predecessorId}`,
          attributes: { comment: "Requires resident Auth profiles first" }
        }
      }
    ]));
    console.log(`Linked predecessor #${predecessorId} -> successor #${successorId}`);
  } catch (error) {
    console.warn(`Link skip #${predecessorId} -> #${successorId}:`, error.message.slice(0, 200));
  }
}

async function findTitlesContaining(fragment) {
  const items = await wiql(
    `Select [System.Id], [System.Title] From WorkItems Where [System.TeamProject] = '${PROJECT}' AND [System.Title] Contains '${fragment.replace(/'/g, "''")}' AND [System.WorkItemType] = 'User Story' Order By [System.Id]`
  );
  if (!items.length) return [];
  const ids = items.map((w) => w.id).join(",");
  const batch = await ado(
    "GET",
    `${API}/wit/workitems?ids=${ids}&fields=System.Id,System.Title&api-version=7.1`,
    undefined,
    undefined
  );
  return (batch.value || []).map((w) => ({
    id: w.id,
    title: w.fields["System.Title"]
  }));
}

const tree = [
  {
    type: "Feature",
    title: "Auth: self-serve password recovery (all logins)",
    iteration: ITER.p1,
    description:
      "<p>Self-serve forgot-password for platform, operator, supervisor, driver, and collection agent logins. Uses Supabase <code>resetPasswordForEmail</code>; recovery completes on web PasswordRecoveryScreen. Admin-assisted staff reset remains.</p>",
    children: [
      {
        title: "Web login Forgot password request + generic success",
        description:
          "<p>Add Forgot password on operator/platform LoginScreen. Call resetPasswordForEmail with redirectTo web origin. Show generic success copy (no account enumeration). Completes via existing PasswordRecoveryScreen.</p>"
      },
      {
        title: "Mobile login Forgot password for driver and agent",
        description:
          "<p>Add Forgot password on mobile SignInScreen. Same reset email API; redirectTo opens web recovery. After password change, user returns to mobile to sign in. Expo deep-link recovery is a later follow-up.</p>"
      },
      {
        title: "Document and smoke Auth redirect + reset email delivery",
        description:
          "<p>Document redirectTo, local Inbucket check, hosted SMTP, Site URL and redirect allow-list for production. Smoke checklist for web and mobile reset paths.</p>"
      }
    ]
  },
  {
    type: "Feature",
    title: "Auth: resident customer login profiles (Phase 2 prerequisite)",
    iteration: ITER.p2,
    description:
      "<p>Prerequisite for resident portal (Know Your PSP / self-serve pay). Link customers.profile_id to profiles with role resident; Admin provision/invite; session gate; reuse self-serve forgot-password. Email-only Auth for v1 (phone-as-username out of scope).</p>",
    children: [
      {
        title: "Schema customers.profile_id + provision_customer_login RPC",
        description:
          "<p>Add customers.profile_id FK to profiles. RPC provision_customer_login / invite mirroring staff auth provisioning; unique login email; role resident; tenant RLS.</p>"
      },
      {
        title: "Admin create or resend resident login for customers with email",
        description:
          "<p>Admin UI: create/resend resident login when customer has email; one-time temp password or invite email; show hasLoginProfile like staff.</p>"
      },
      {
        title: "Resident session gate in get_session_operator_context",
        description:
          "<p>Session context returns resident-safe fields. Web/mobile refuse operator-only RPCs for role resident. Map auth.uid to customer row.</p>"
      },
      {
        title: "Confirm forgot-password works for resident Auth users",
        description:
          "<p>No new reset mechanism — verify self-serve Feature A path works once resident Auth users exist.</p>"
      },
      {
        title: "Spike note: email-only Auth; phone username out of scope v1",
        description:
          "<p>Short spike/doc: v1 resident login is email-based Supabase Auth only. Phone OTP / phone-as-username deferred.</p>"
      }
    ]
  }
];

async function main() {
  const created = {};

  for (const feature of tree) {
    const f = await createItem("Feature", feature.title, feature.description, feature.iteration, EPIC_ID);
    created[feature.title] = f.id;
    for (const story of feature.children) {
      const s = await createItem("User Story", story.title, story.description, feature.iteration, f.id);
      created[story.title] = s.id;
    }
  }

  // Link Feature B provision / session stories as predecessors of P2 resident portal stories.
  const predecessorTitles = [
    "Schema customers.profile_id + provision_customer_login RPC",
    "Resident session gate in get_session_operator_context"
  ];
  const predecessorIds = predecessorTitles.map((t) => created[t]).filter(Boolean);

  const p2Candidates = await findTitlesContaining("Resident");
  const successors = p2Candidates.filter((w) =>
    /balance|Paystack|missed-collection|complaint|schedule view|self-serve/i.test(w.title)
  );

  for (const pred of predecessorIds) {
    for (const succ of successors) {
      if (succ.id !== pred) {
        await addPredecessor(succ.id, pred);
      }
    }
  }

  console.log("\nCreated/resolved:");
  for (const [title, id] of Object.entries(created)) {
    console.log(`  #${id} ${title}`);
    console.log(`     https://dev.azure.com/${ORG}/${PROJECT}/_workitems/edit/${id}`);
  }
  console.log(`\nEpic: https://dev.azure.com/${ORG}/${PROJECT}/_workitems/edit/${EPIC_ID}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
