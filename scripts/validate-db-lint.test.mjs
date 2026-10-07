import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateSupabaseLint,
  parseSupabaseLintOutput
} from "./validate-db-lint.mjs";

const postgisFinding = {
  function: "public.addgeometrycolumn",
  issues: [{ level: "error", message: "function search_path is mutable" }]
};

const applicationFinding = {
  function: "public.assert_route_planning_allowed",
  issues: [{ level: "error", message: "function search_path is mutable" }]
};

test("parses the legacy single-line results object", () => {
  const stdout = `Connecting to local database...\n${JSON.stringify({
    results: [applicationFinding]
  })}\n`;

  const report = parseSupabaseLintOutput(stdout, "");

  assert.deepEqual(report.results, [applicationFinding]);
});

test("parses a pretty-printed JSON array of lint findings", () => {
  const stdout = `${JSON.stringify([postgisFinding, applicationFinding], null, 2)}\n`;

  const report = parseSupabaseLintOutput(stdout, "some cli log");

  assert.deepEqual(report.results, [postgisFinding, applicationFinding]);
});

test("keeps the PostGIS ignore list and reports application errors", () => {
  const outcome = evaluateSupabaseLint({
    status: 1,
    stdout: JSON.stringify([postgisFinding, applicationFinding], null, 2),
    stderr: ""
  });

  assert.deepEqual(outcome.ignoredExtensionErrors, [postgisFinding]);
  assert.deepEqual(outcome.applicationErrors, [applicationFinding]);
});

test("throws when lint output cannot be parsed", () => {
  assert.throws(
    () => parseSupabaseLintOutput("supabase db lint failed: connection refused", ""),
    /Unable to parse Supabase lint output/
  );
});

test("throws when the CLI exits nonzero and returns no results", () => {
  assert.throws(
    () =>
      evaluateSupabaseLint({
        status: 1,
        stdout: '{"results":[]}',
        stderr: "error running lint"
      }),
    /exited with status 1 and no results/
  );
});

test("accepts an empty result set when the CLI exits zero", () => {
  const outcome = evaluateSupabaseLint({
    status: 0,
    stdout: '{"results":[]}',
    stderr: ""
  });

  assert.deepEqual(outcome.applicationErrors, []);
  assert.deepEqual(outcome.ignoredExtensionErrors, []);
});
