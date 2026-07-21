# Create LAWMA suggested build-order backlog in Azure DevOps Boards.
# Requires: az + azure-devops extension, .env_PAT.local with Work Items Read/Write/Manage.

$ErrorActionPreference = "Continue"
$org = "https://dev.azure.com/benjaminbabawale-elevatedtech"
$project = "CleanOps"
$patPath = Join-Path $PSScriptRoot "../.env_PAT.local"
$pat = (Get-Content $patPath -Raw).Trim()
if (-not $pat) { throw "Missing PAT in .env_PAT.local" }

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
  [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:AZURE_DEVOPS_EXT_PAT = $pat
az devops configure --defaults organization=$org project=$project 2>$null | Out-Null

# Skip if already created
$existingJson = az boards query `
  --organization $org `
  --project $project `
  --wiql "Select [System.Id] From WorkItems Where [System.TeamProject] = '$project' AND [System.Tags] Contains 'lawma-build-order'" `
  -o json 2>$null
$existing = if ($existingJson) { $existingJson | ConvertFrom-Json } else { @() }
if (@($existing).Count -gt 0) {
  Write-Host "Found $(@($existing).Count) lawma-build-order items already. Skipping create."
  Write-Host "Backlogs: $org/$project/_backlogs/backlog"
  exit 0
}

function New-Iteration {
  param([string]$Name, [string]$Start, [string]$Finish)
  $path = "\$project\Iteration\$Name"
  # Create if missing
  az boards iteration project create --name $Name --path "\$project" --start-date $Start --finish-date $Finish --organization $org --project $project -o none 2>$null | Out-Null
  # Team backlog visibility
  az boards iteration team add --id $null --path $path --organization $org --project $project --team "CleanOps Team" -o none 2>$null | Out-Null
  return "$project\$Name"
}

function New-AdoItem {
  param(
    [string]$Type,
    [string]$Title,
    [string]$Description,
    [string]$Iteration,
    [string]$State = "New",
    [int]$ParentId = 0,
    [string]$Tags = "cleanops; lawma-build-order"
  )

  $json = az boards work-item create `
    --title $Title `
    --type $Type `
    --organization $org `
    --project $project `
    --fields `
      "System.Description=$Description" `
      "System.IterationPath=$Iteration" `
      "System.AreaPath=$project" `
      "System.Tags=$Tags" `
    -o json 2>$null

  if ($LASTEXITCODE -ne 0 -or -not $json) {
    throw "Failed to create $Type '$Title'"
  }
  $item = $json | ConvertFrom-Json
  if (-not $item.id) { throw "No id for $Type '$Title'" }

  if ($ParentId -gt 0) {
    az boards work-item relation add `
      --id $item.id `
      --relation-type parent `
      --target-id $ParentId `
      --organization $org `
      -o none 2>$null | Out-Null
  }

  if ($State -and $State -ne "New") {
    $steps = if ($State -eq "Closed" -or $State -eq "Done") {
      @("Active", "Resolved", "Closed")
    } elseif ($State -eq "Active") {
      @("Active")
    } else {
      @($State)
    }
    foreach ($step in $steps) {
      az boards work-item update --id $item.id --state $step --organization $org -o none 2>$null | Out-Null
    }
  }

  Write-Host ("{0} #{1}: {2}" -f $Type, $item.id, $Title)
  return $item
}

Write-Host "Creating iterations..."
$iterP1 = New-Iteration -Name "Sprint 12 - LAWMA P1 Evidence" -Start "2026-07-15" -Finish "2026-07-28"
$iterP2 = New-Iteration -Name "Sprint 13 - LAWMA P2 Resident" -Start "2026-07-29" -Finish "2026-08-11"
$iterP25 = New-Iteration -Name "Sprint 14 - LAWMA P2.5 Ops Analytics" -Start "2026-08-12" -Finish "2026-08-25"
$iterP3 = New-Iteration -Name "Sprint 15 - LAWMA P3 Reporting Debt" -Start "2026-08-26" -Finish "2026-09-08"
$iterOpt = New-Iteration -Name "Sprint 16 - LAWMA Optional Packs" -Start "2026-09-09" -Finish "2026-09-22"

# Fallback if iteration create failed naming
if (-not $iterP1) { $iterP1 = "$project\Sprint 12 - LAWMA P1 Evidence" }
if (-not $iterP2) { $iterP2 = "$project\Sprint 13 - LAWMA P2 Resident" }
if (-not $iterP25) { $iterP25 = "$project\Sprint 14 - LAWMA P2.5 Ops Analytics" }
if (-not $iterP3) { $iterP3 = "$project\Sprint 15 - LAWMA P3 Reporting Debt" }
if (-not $iterOpt) { $iterOpt = "$project\Sprint 16 - LAWMA Optional Packs" }

Write-Host "Creating Epic + Features + User Stories..."

$epic = New-AdoItem -Type "Epic" -Title "LAWMA-aligned PSP build order (P1-P3 + optional packs)" `
  -Iteration $iterP1 -State "Active" `
  -Description @"
<p><b>Goal:</b> Extend CleanOps so Lagos PSPs run more efficiently, profitably, and compliant with LAWMA SOP + Service Charter.</p>
<p><b>Order:</b> P1 disposal/complaints/bills → P2 Know Your PSP + resident missed collection → P2.5 dumpsite & coverage analytics → P3 LAWMA pack/debt/markets → optional medical/highway/recycling.</p>
<p>Already shipped: daily ops, LAWMA collection frequency (WI #50), payments, dumpsite run stubs, multi-tenant Phase A.</p>
"@

# --- P1 ---
$fP1 = New-AdoItem -Type "Feature" -Title "P1: Disposal evidence, complaint 24h SLA, bill delivery" `
  -ParentId $epic.id -Iteration $iterP1 -State "Active" `
  -Description "<p>First build slice: prove waste went to legal weighed destinations, close citizen/facility complaints within 24h, and track bill delivery for revenue charts.</p>"

New-AdoItem -Type "User Story" -Title "Capture weighbridge tonnage + disposal dockets on dumpsite runs" `
  -ParentId $fP1.id -Iteration $iterP1 `
  -Description "<p>Extend dumpsite_runs with receipt/docket number, weighbridge tonnes (or photo of ticket), landfill site identity. Driver mobile + operator review. Aligns with LAWMA SOP Disposal rules.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Log illegal dump / skeletal service cases with geo + photo evidence" `
  -ParentId $fP1.id -Iteration $iterP1 `
  -Description "<p>Case log for SOP offences (illegal dumping, irregular service). Link to route/stop/customer. Supports LAWMA audit defence.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Complaints inbox with 24-hour SLA clock and escalation" `
  -ParentId $fP1.id -Iteration $iterP1 `
  -Description "<p>Operator (and later resident) complaints: missed stop, overflow, crew issue. Acknowledge/act within 24h per Service Charter/SOP. Escalation to supervisor. History + dashboard SLA metrics.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Bill delivery workflow with agent acknowledgement" `
  -ParentId $fP1.id -Iteration $iterP1 `
  -Description "<p>Record bill period, amount, delivery status, agent delivery ack (time/GPS optional). Feeds payment chart and bill-cycle discipline from revenue SOP.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Vehicle branding & PPE checklist per truck/shift" `
  -ParentId $fP1.id -Iteration $iterP1 `
  -Description "<p>Checklist: ward inscription, phone, colour coding, amber light, netting/tarpaulin, PPE for gang. Inspection-ready before dispatch.</p>" | Out-Null

# --- P2 ---
$fP2 = New-AdoItem -Type "Feature" -Title "P2: Know Your PSP + resident missed collection + self-serve pay" `
  -ParentId $epic.id -Iteration $iterP2 `
  -Description "<p>Resident-facing accountability aligned to LAWMA Know Your PSP campaign and Charter complaint rights.</p>"

New-AdoItem -Type "User Story" -Title "Public PSP identity card by ward/zone (name, phone, days, plates)" `
  -ParentId $fP2.id -Iteration $iterP2 `
  -Description "<p>Resident portal section or shareable page: who operates this ward, contacts, preferred collection weekdays, truck contacts.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Resident missed-collection and service complaint submission" `
  -ParentId $fP2.id -Iteration $iterP2 `
  -Description "<p>Residents report missed pickup; opens P1 complaint with SLA; optional make-good stop task.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Resident balance, history, and Paystack self-serve payment" `
  -ParentId $fP2.id -Iteration $iterP2 `
  -Description "<p>Phase 2 resident ledger view + initiate Paystack checkout wired to existing webhook.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Collection schedule view for household (preferred weekdays)" `
  -ParentId $fP2.id -Iteration $iterP2 `
  -Description "<p>Show residential/commercial schedule from collections_per_week + preferred_weekdays already on customers.</p>" | Out-Null

# --- P2.5 ---
$fP25 = New-AdoItem -Type "Feature" -Title "P2.5: Dumpsite status planning + due-today coverage analytics" `
  -ParentId $epic.id -Iteration $iterP25 `
  -Description "<p>Ops efficiency: where to tip, who is due vs who was skipped.</p>"

New-AdoItem -Type "User Story" -Title "Dumpsite registry with open/congested/closed status board" `
  -ParentId $fP25.id -Iteration $iterP25 `
  -Description "<p>Master data for LAWMA-approved sites; status logs; operator board. Builds on dumpsite_runs.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Zone proximity / nearest open dumpsite recommendations" `
  -ParentId $fP25.id -Iteration $iterP25 `
  -Description "<p>Suggest tip site per zone/route using PostGIS distance + status.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Due-today vs completed coverage map and skip analytics" `
  -ParentId $fP25.id -Iteration $iterP25 `
  -Description "<p>Dashboard/map: due customers vs completed/skipped; skip-reason trends for skeletal-service risk.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Compactor utilisation vs ward capacity guidance" `
  -ParentId $fP25.id -Iteration $iterP25 `
  -Description "<p>Surface fleet count vs SOP min-2-compactors-per-ward style capacity guidance.</p>" | Out-Null

# --- P3 ---
$fP3 = New-AdoItem -Type "Feature" -Title "P3: LAWMA monthly pack, debt ladder, markets/schools" `
  -ParentId $epic.id -Iteration $iterP3 `
  -Description "<p>Institutional reporting, formal debt process, sectoral facilities.</p>"

New-AdoItem -Type "User Story" -Title "Exportable monthly LAWMA operations pack (tonnage, coverage, complaints SLA)" `
  -ParentId $fP3.id -Iteration $iterP3 `
  -Description "<p>One-click PDF/CSV pack for audit and monitoring officers.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "LAWMA reporting API integration hooks" `
  -ParentId $fP3.id -Iteration $iterP3 `
  -Description "<p>Phase 3 API adapter when LAWMA endpoints available; same datasets as monthly pack.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Demand-notice debt ladder with ageing and recalcitrant queue" `
  -ParentId $fP3.id -Iteration $iterP3 `
  -Description "<p>Debt & compliance workflow: notices, verify steps, escalate to legal/enforcement handoff.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Per-trip commercial billing with docket + customer confirm" `
  -ParentId $fP3.id -Iteration $iterP3 `
  -Description "<p>SOP per-trip bills require client confirmation + PSP dockets.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Market / school / plaza facility customer types and weekly SLA" `
  -ParentId $fP3.id -Iteration $iterP3 `
  -Description "<p>Extend customer types; Charter market weekly clearance; sectoral management.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Commercial prospect pipeline (visit → MoU → enlistment code)" `
  -ParentId $fP3.id -Iteration $iterP3 `
  -Description "<p>Business Development SOP: evaluation, 10-day enlistment, unique client ID.</p>" | Out-Null

# --- Optional ---
$fOpt = New-AdoItem -Type "Feature" -Title "Optional industry packs: medical, highway, recycling" `
  -ParentId $epic.id -Iteration $iterOpt `
  -Description "<p>Only enable per tenant franchise. Medical remittance, highway photo/attendance, recyclables ledger.</p>"

New-AdoItem -Type "User Story" -Title "Healthcare waste module (segregation, specialised vehicle, LAWMA remittance %)" `
  -ParentId $fOpt.id -Iteration $iterOpt `
  -Description "<p>Optional pack for accredited HCW operators only.</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Highway sanitation attendance + photo proof + performance score" `
  -ParentId $fOpt.id -Iteration $iterOpt `
  -Description "<p>Optional pack for highway contract holders (attendance triplicate, stamped photos, ≥65% rating).</p>" | Out-Null

New-AdoItem -Type "User Story" -Title "Recyclables diversion and buy-back ledger" `
  -ParentId $fOpt.id -Iteration $iterOpt `
  -Description "<p>Optional Phase 3+ revenue: sorting, material sales, resident incentives.</p>" | Out-Null

# List created
az boards query --organization $org --project $project `
  --wiql "Select [System.Id], [System.WorkItemType], [System.Title], [System.State] From WorkItems Where [System.Tags] Contains 'lawma-build-order' Order By [System.Id]" `
  -o table

Write-Host ""
Write-Host "Epic: $org/$project/_workitems/edit/$($epic.id)"
Write-Host "Done."
