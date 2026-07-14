# Sync CleanOps historical sprints + completed work into Azure DevOps Boards via Azure CLI.
# Requires: az + azure-devops extension, and .env_PAT.local with Work Items (Read, write, & manage).

$ErrorActionPreference = "Continue"
$org = "https://dev.azure.com/benjaminbabawale-elevatedtech"
$project = "CleanOps"
$team = "CleanOps Team"
$patPath = Join-Path $PSScriptRoot "../.env_PAT.local"
$pat = (Get-Content $patPath -Raw).Trim()
if (-not $pat) { throw "Missing PAT in .env_PAT.local" }

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
  [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:AZURE_DEVOPS_EXT_PAT = $pat

az devops configure --defaults organization=$org project=$project 2>$null | Out-Null
$ErrorActionPreference = "Continue"

function New-AdoItem {
  param(
    [string]$Type,
    [string]$Title,
    [string]$Description,
    [string]$Iteration,
    [string]$State = "New",
    [int]$ParentId = 0
  )

  $args = @(
    "boards", "work-item", "create",
    "--title", $Title,
    "--type", $Type,
    "--organization", $org,
    "--project", $project,
    "--fields",
    "System.Description=$Description",
    "System.IterationPath=$Iteration",
    "System.AreaPath=$project",
    "System.Tags=cleanops; historical-sync"
  )

  $json = & az @args -o json 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $json) {
    throw "Failed to create $Type '$Title' (exit $LASTEXITCODE)"
  }
  $item = $json | ConvertFrom-Json

  if (-not $item.id) {
    throw "Create returned no id for $Type '$Title': $json"
  }

  if ($ParentId -gt 0) {
    & az boards work-item relation add `
      --id $item.id `
      --relation-type parent `
      --target-id $ParentId `
      --organization $org `
      -o none 2>$null | Out-Null
  }

  if ($State -and $State -ne "New") {
    # Process uses New / Active / Resolved / Closed for Epic, Feature, and User Story
    $steps = if ($State -eq "Done" -or $State -eq "Closed") {
      @("Active", "Resolved", "Closed")
    } elseif ($State -eq "Active") {
      @("Active")
    } else {
      @($State)
    }

    foreach ($step in $steps) {
      & az boards work-item update --id $item.id --state $step --organization $org -o none 2>$null | Out-Null
    }
  }

  return $item
}

# Skip if already synced
$existingJson = az boards query `
  --organization $org `
  --project $project `
  --wiql "Select [System.Id] From WorkItems Where [System.TeamProject] = '$project' AND [System.Tags] Contains 'historical-sync'" `
  -o json 2>$null
$existing = if ($existingJson) { $existingJson | ConvertFrom-Json } else { @() }
$existingCount = @($existing).Count
if ($existingCount -gt 0) {
  Write-Host "Found $existingCount historical-sync items already. Skipping."
  Write-Host "Backlogs: $org/$project/_backlogs/backlog"
  exit 0
}

Write-Host "Creating Epic + Features + User Stories (Agile process)..."

$epic = New-AdoItem -Type "Epic" -Title "Phase 1 - Core Ops Pilot" -State "Done" `
  -Iteration "$project\Sprint 10 - Multi-tenant Phase A" `
  -Description "Phase 1 CleanOps pilot: operator web, driver/agent mobile, Supabase multi-tenant model, payments, and SaaS onboarding. Synced from docs/build-plan.md through 13 Jul 2026."
Write-Host "Epic #$($epic.id)"

$completed = @(
  @{
    Sprint = "Sprint 0 - Foundation"
    Feature = "Foundation: schema, monorepo, local Supabase pilot"
    Desc = "TypeScript monorepo, PostgreSQL schema with RLS, seed pilot operator, auth helpers, shared Zod models. Commit 03d1931."
    Stories = @(
      "Define tenant schema, enums, RLS, and seed data"
      "Configure local Supabase + shared TypeScript schemas"
    )
  }
  @{
    Sprint = "Sprint 1 - Collection Agent"
    Feature = "Sprint 1: Collection agent mobile + operator reconciliation"
    Desc = "Agents collect cash in the field; operators reconcile in Payments. Migrations 0016-0021. Commit 69c017e."
    Stories = @(
      "Agent customer search and payment entry"
      "Agent daily summary + offline queue"
      "Operator agent collections reconciliation"
    )
  }
  @{
    Sprint = "Sprint 2 - Staff Auth"
    Feature = "Sprint 2: Staff auth provisioning from Admin"
    Desc = "Operators create staff logins without manual DB work; mobile email/password sign-in. Migrations 0022-0024. Commit c3b57fe."
    Stories = @(
      "Onboard staff with Auth user + temp password"
      "Provision login / password reset for existing staff"
      "Mobile credential sign-in for provisioned staff"
    )
  }
  @{
    Sprint = "Sprint 3 - Paystack Webhook"
    Feature = "Sprint 3: Paystack charge.success webhook posting"
    Desc = "HMAC-verified webhook posts idempotent payments; ledger auto-refresh. Migration 0025."
    Stories = @(
      "Verify signature and post Paystack payments"
      "Shared Paystack helpers + smoke script"
    )
  }
  @{
    Sprint = "Sprint 4 - Driver Field Logs"
    Feature = "Sprint 4: Driver fuel + dumpsite field logging"
    Desc = "Mobile fuel logs and dumpsite depart/arrive/clear against assigned route. Migration 0026."
    Stories = @(
      "Fuel log RPC + mobile form"
      "Dumpsite run phases on mobile"
    )
  }
  @{
    Sprint = "Sprint 5 - Truck Handoffs"
    Feature = "Sprint 5: Truck reassignment and route takeover"
    Desc = "Operator proposes handoffs; drivers confirm/decline on mobile. Extended for driver cover."
    Stories = @(
      "Propose / confirm / reject truck handoffs"
      "Driver mobile handoff banner"
      "Driver cover + shift cover summaries"
    )
  }
  @{
    Sprint = "Sprint 6 - Floating Trucks"
    Feature = "Sprint 6: Unhook trucks from hard zone assignment"
    Desc = "Any operational/standby truck can be assigned to any zone; home zone optional. Migration 0030."
    Stories = @(
      "Floating fleet assignment in planner + Admin"
    )
  }
  @{
    Sprint = "Sprint 7 - Zone Templates"
    Feature = "Sprint 7: Zone templates and daily auto-load"
    Desc = "Zone default/temp templates, save prompt after edits, auto-load at start of day, driver notices."
    Stories = @(
      "Save route as zone default or temporary template"
      "Auto-load daily routes for operator and eligible drivers"
      "In-app route-change notices for drivers"
    )
  }
  @{
    Sprint = "Sprint 8 - Admin Edit Flows"
    Feature = "Sprint 8: Edit staff, trucks, and customers"
    Desc = "Update existing master-data records. Migration 0042."
    Stories = @(
      "Admin edit RPCs + UI for staff/truck/customer"
    )
  }
  @{
    Sprint = "Sprint 9 - Licence and SaaS UI"
    Feature = "Sprint 9: Driver licences, profiles, SaaS operator UI"
    Desc = "Licence vault fields/uploads, self-service profiles, operator web SaaS redesign. Migrations 0043-0044."
    Stories = @(
      "Driver licence fields + private storage uploads"
      "Self-service operator/staff profile management"
      "SaaS UI redesign for operator web"
    )
  }
  @{
    Sprint = "Sprint 10 - Multi-tenant Phase A"
    Feature = "Sprint 10: Platform admin multi-tenant onboarding"
    Desc = "Platform admin console, tenant onboarding, Island Clean seed, isolation fixes. Migrations 0045-0047."
    Stories = @(
      "Platform admin RPCs + console UI"
      "Seed Island Clean + packaging docs"
      "Remove live-mode pilot data fallbacks"
      "Restore API table grants for authenticated role"
    )
  }
)

$created = 0
foreach ($block in $completed) {
  $iter = "$project\$($block.Sprint)"
  $feature = New-AdoItem -Type "Feature" -Title $block.Feature -State "Done" `
    -Iteration $iter -Description $block.Desc -ParentId $epic.id
  Write-Host "Feature #$($feature.id) - $($block.Feature)"
  $created++

  foreach ($story in $block.Stories) {
    $pbi = New-AdoItem -Type "User Story" -Title $story -State "Closed" `
      -Iteration $iter -Description $block.Desc -ParentId $feature.id
    Write-Host "  Story #$($pbi.id) - $story"
    $created++
  }
}

Write-Host "Creating Sprint 11 open backlog..."
$iter11 = "$project\Sprint 11 - Quality Gate"
$f11 = New-AdoItem -Type "Feature" -Title "Sprint 11: Quality gate (CI + smoke + device QA)" -State "New" `
  -Iteration $iter11 `
  -Description "Next build item. CI typecheck + migration lint; smoke tests; Android device QA for driver + agent offline sync." `
  -ParentId $epic.id
$created++

foreach ($title in @(
  "Add CI pipeline for typecheck and migration checks",
  "Browser smoke tests for critical operator flows",
  "Android device QA for driver and agent offline sync"
)) {
  $pbi = New-AdoItem -Type "User Story" -Title $title -State "New" `
    -Iteration $iter11 -Description "From docs/build-plan.md quality gate." -ParentId $f11.id
  Write-Host "  Story #$($pbi.id) - $title"
  $created++
}

# Clean up the earlier PAT probe task if present
az boards work-item delete --id 2 --organization $org --project $project --yes --destroy -o none 2>$null | Out-Null

Write-Host ""
Write-Host "Done. Created $created work items under Epic #$($epic.id)"
Write-Host "Boards: $org/$project/_boards/board/t/$([uri]::EscapeDataString($team))"
Write-Host "Backlogs: $org/$project/_backlogs/backlog"
Write-Host "Sprints: $org/$project/_sprints/directory"
