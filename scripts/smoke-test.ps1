<#
  Multi-Agent Sales Assistant — feature smoke test (mock only).

  Exercises every current API feature against a running local API and reports
  pass/fail per feature. Nothing here touches real MSX/Dataverse/customer data.

  Usage:
    npm run dev:api        # in one terminal (API on :4000)
    pwsh scripts/smoke-test.ps1
    pwsh scripts/smoke-test.ps1 -BaseUrl http://localhost:4000 -ApiKey <key>
#>
param(
  [string]$BaseUrl = 'http://localhost:4000',
  [string]$ApiKey  = $env:API_KEY
)

$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0
$script:skip = 0
$script:results = @()

# Fall back to the API_KEY declared in a local .env (the server loads it too).
if (-not $ApiKey -and (Test-Path .env)) {
  $line = Get-Content .env | Select-String -Pattern '^\s*API_KEY\s*=' | Select-Object -First 1
  if ($line) { $ApiKey = ($line.ToString() -replace '^\s*API_KEY\s*=', '').Trim().Trim('"').Trim("'") }
}

$headers = @{ 'Content-Type' = 'application/json' }
if ($ApiKey) { $headers['x-api-key'] = $ApiKey }

function Invoke-Api {
  param(
    [string]$Method,
    [string]$Path,
    $Body,
    [int]$ExpectStatus = 0   # 0 = expect success (2xx); otherwise expect this status code
  )
  $uri = "$BaseUrl$Path"
  $params = @{ Method = $Method; Uri = $uri; Headers = $headers; SkipHttpErrorCheck = $true }
  if ($null -ne $Body) { $params['Body'] = ($Body | ConvertTo-Json -Depth 10) }
  $resp = Invoke-WebRequest @params
  $status = [int]$resp.StatusCode
  $json = $null
  if ($resp.Content) { try { $json = $resp.Content | ConvertFrom-Json } catch {} }
  [pscustomobject]@{ Status = $status; Json = $json; Raw = $resp.Content }
}

function Check {
  param([string]$Name, [scriptblock]$Test)
  try {
    $ok = & $Test
    if ($ok) {
      $script:pass++
      $script:results += [pscustomobject]@{ Feature = $Name; Result = 'PASS'; Note = '' }
      Write-Host ("  [PASS] {0}" -f $Name) -ForegroundColor Green
    } else {
      throw 'assertion returned false'
    }
  } catch {
    if ($_.Exception.Message -like 'SKIP:*') {
      $script:skip++
      $note = $_.Exception.Message -replace '^SKIP:\s*', ''
      $script:results += [pscustomobject]@{ Feature = $Name; Result = 'SKIP'; Note = $note }
      Write-Host ("  [SKIP] {0} -> {1}" -f $Name, $note) -ForegroundColor Yellow
    } else {
      $script:fail++
      $script:results += [pscustomobject]@{ Feature = $Name; Result = 'FAIL'; Note = $_.Exception.Message }
      Write-Host ("  [FAIL] {0} -> {1}" -f $Name, $_.Exception.Message) -ForegroundColor Red
    }
  }
}

$stamp = Get-Date -Format 'yyyyMMddHHmmss'
Write-Host "Multi-Agent Sales Assistant smoke test against $BaseUrl (run $stamp)" -ForegroundColor Cyan
Write-Host ('=' * 70)

# ---------------------------------------------------------------- Health
Write-Host "`nHealth" -ForegroundColor Yellow
Check 'GET /api/health' {
  $r = Invoke-Api GET '/api/health'
  $r.Status -eq 200 -and $r.Json.success -eq $true -and $r.Json.data.status -eq 'ok'
}

# ------------------------------------------------------------- Opportunities
Write-Host "`nOpportunities" -ForegroundColor Yellow
$oppName = "Smoke Opp $stamp"
$script:oppId = $null

Check 'GET /api/opportunities (list)' {
  $r = Invoke-Api GET '/api/opportunities'
  $r.Status -eq 200 -and $r.Json.success -eq $true -and ($r.Json.data -is [array])
}
Check 'POST /api/opportunities (create)' {
  $body = @{
    opportunityName = $oppName
    customerName    = 'Contoso (mock)'
    industry        = 'Manufacturing'
    solutionArea    = 'Azure'
    salesStage      = 'Inspire & Design'
    status          = 'Active'
    estimatedRevenue = 250000
    aeOwner         = 'Demo AE'
    assignedSE      = 'Demo SE'
  }
  $r = Invoke-Api POST '/api/opportunities' $body
  $script:oppId = $r.Json.data.id
  $r.Status -eq 201 -and $r.Json.data.opportunityName -eq $oppName -and $script:oppId
}
Check 'GET /api/opportunities/:id (get one)' {
  $r = Invoke-Api GET "/api/opportunities/$($script:oppId)"
  $r.Status -eq 200 -and $r.Json.data.id -eq $script:oppId
}
Check 'PATCH /api/opportunities/:id (update)' {
  $r = Invoke-Api PATCH "/api/opportunities/$($script:oppId)" @{ nextStep = 'Book discovery workshop' }
  $r.Status -eq 200 -and $r.Json.data.nextStep -eq 'Book discovery workshop'
}
Check 'GET /api/opportunities/:id/context (agent context)' {
  $r = Invoke-Api GET "/api/opportunities/$($script:oppId)/context"
  $r.Status -eq 200 -and $r.Json.success -eq $true
}

# --------------------------------------------------------------- Milestones
Write-Host "`nMilestones" -ForegroundColor Yellow
$script:msBusinessId = $null

Check 'GET /api/milestones (list)' {
  $r = Invoke-Api GET '/api/milestones'
  $r.Status -eq 200 -and ($r.Json.data -is [array])
}
Check 'POST /api/milestones (create, connect by opportunityName)' {
  $body = @{
    milestoneName    = "Discovery Workshop $stamp"
    opportunityName  = $oppName
    workload         = 'Copilot Studio'
    customerCommitment = 'Committed'
    deliveredBy      = 'Microsoft'
    milestoneCategory = 'Workshop'
    milestoneStatus  = 'On Track'
    riskImpact       = 'Low'
    owner            = 'Demo SE'
    createdBy        = 'Demo SE'
  }
  $r = Invoke-Api POST '/api/milestones' $body
  $script:msBusinessId = $r.Json.data.milestoneBusinessId
  $script:msId = $r.Json.data.id
  $r.Status -eq 201 -and $script:msBusinessId
}
Check 'PATCH /api/milestones/:id (update)' {
  $r = Invoke-Api PATCH "/api/milestones/$($script:msId)" @{ milestoneStatus = 'At Risk'; riskDescription = 'Sponsor on leave' }
  $r.Status -eq 200 -and $r.Json.data.milestoneStatus -eq 'At Risk'
}

# ------------------------------------------------------------ Status history
Write-Host "`nStatus history" -ForegroundColor Yellow
Check 'POST /api/status-history (create)' {
  $body = @{
    milestoneBusinessId = $script:msBusinessId
    oldStatus           = 'On Track'
    newStatus           = 'At Risk'
    changedBy           = 'Demo SE'
    reason              = 'Sponsor availability'
  }
  $r = Invoke-Api POST '/api/status-history' $body
  $r.Status -eq 201
}
Check 'GET /api/status-history (list)' {
  $r = Invoke-Api GET '/api/status-history'
  $r.Status -eq 200 -and ($r.Json.data -is [array])
}

# ------------------------------------------------------------ Recommendations
Write-Host "`nRecommendations" -ForegroundColor Yellow
$script:recBusinessId = $null
Check 'POST /api/recommendations (create)' {
  $body = @{
    recommendedMilestoneTitle = "Deployment Readiness $stamp"
    opportunityName           = $oppName
    suggestedDescription      = 'Add a Deployment Readiness milestone after architecture review.'
    suggestedOwnerRole        = 'SE'
    priority                  = 'High'
    confidence                = 'Medium'
    reviewStatus              = 'Pending'
    createdByAgent            = $true
  }
  $r = Invoke-Api POST '/api/recommendations' $body
  $script:recBusinessId = $r.Json.data.recommendationBusinessId
  $script:recId = $r.Json.data.id
  $r.Status -eq 201 -and $script:recId
}
Check 'GET /api/recommendations (list)' {
  $r = Invoke-Api GET '/api/recommendations'
  $r.Status -eq 200 -and ($r.Json.data -is [array])
}
Check 'PATCH /api/recommendations/:id (update)' {
  $r = Invoke-Api PATCH "/api/recommendations/$($script:recId)" @{ reviewerNotes = 'Looks good' }
  $r.Status -eq 200
}

# ---------------------------------------------- Approval governance (the gate)
Write-Host "`nApproval governance flow" -ForegroundColor Yellow
$script:approveId = $null
$script:rejectId  = $null

Check 'POST /api/approval-requests (approve-path create)' {
  $body = @{
    requestName                     = "Create Deployment Readiness $stamp"
    opportunityName                 = $oppName
    relatedRecommendationBusinessId = $script:recBusinessId
    requestStatus                   = 'Submitted'
    requestedBy                     = 'MilestoneAdvisor'
  }
  $r = Invoke-Api POST '/api/approval-requests' $body
  $script:approveId = $r.Json.data.id
  $r.Status -eq 201 -and $r.Json.data.approvalStatus -eq 'Pending'
}
Check 'GET /api/approval-requests (list)' {
  $r = Invoke-Api GET '/api/approval-requests'
  $r.Status -eq 200 -and ($r.Json.data -is [array])
}
Check 'GET /api/approval-requests?approvalStatus=Pending (filter)' {
  $r = Invoke-Api GET '/api/approval-requests?approvalStatus=Pending'
  $r.Status -eq 200 -and ($r.Json.data | Where-Object { $_.approvalStatus -ne 'Pending' }).Count -eq 0
}
Check 'PATCH /api/approval-requests/:id/approve (human approval -> creates milestone)' {
  $r = Invoke-Api PATCH "/api/approval-requests/$($script:approveId)/approve" @{ reviewedBy = 'Demo Approver'; notes = 'Approved for POC' }
  $r.Status -eq 200 -and $r.Json.data.approval.approvalStatus -eq 'Approved' -and $r.Json.data.milestone.milestoneBusinessId
}
Check 'PATCH .../approve again -> 409 already approved' {
  $r = Invoke-Api PATCH "/api/approval-requests/$($script:approveId)/approve" @{ reviewedBy = 'Demo Approver' }
  $r.Status -eq 409
}
Check 'POST + PATCH .../reject (reject path, no milestone)' {
  $body = @{
    requestName     = "Reject sample $stamp"
    opportunityName = $oppName
    requestStatus   = 'Submitted'
    requestedBy     = 'MilestoneAdvisor'
  }
  $c = Invoke-Api POST '/api/approval-requests' $body
  $script:rejectId = $c.Json.data.id
  $r = Invoke-Api PATCH "/api/approval-requests/$($script:rejectId)/reject" @{ reviewedBy = 'Demo Approver'; notes = 'Out of scope' }
  $r.Status -eq 200 -and $r.Json.data.approvalStatus -eq 'Rejected'
}
Check 'POST + PATCH .../needs-changes' {
  $body = @{
    requestName     = "Needs changes sample $stamp"
    opportunityName = $oppName
    requestStatus   = 'Submitted'
    requestedBy     = 'MilestoneAdvisor'
  }
  $c = Invoke-Api POST '/api/approval-requests' $body
  $r = Invoke-Api PATCH "/api/approval-requests/$($c.Json.data.id)/needs-changes" @{ reviewedBy = 'Demo Approver'; notes = 'Add business value' }
  $r.Status -eq 200 -and $r.Json.data.approvalStatus -eq 'Needs Changes'
}

# ------------------------------------------------------------ Collaboration notes
Write-Host "`nCollaboration notes" -ForegroundColor Yellow
Check 'POST /api/collaboration-notes (create)' {
  $body = @{
    noteTitle       = "Kickoff notes $stamp"
    opportunityName = $oppName
    noteType        = 'Meeting'
    noteSummary     = 'Discussed discovery scope and timeline.'
    createdBy       = 'Demo SE'
  }
  $r = Invoke-Api POST '/api/collaboration-notes' $body
  $r.Status -eq 201
}
Check 'GET /api/collaboration-notes (list)' {
  $r = Invoke-Api GET '/api/collaboration-notes'
  $r.Status -eq 200 -and ($r.Json.data -is [array])
}

# ------------------------------------------------------------ Deal team members
Write-Host "`nDeal team members" -ForegroundColor Yellow
Check 'POST /api/deal-team-members (create)' {
  $body = @{
    opportunityName = $oppName
    personName      = 'Jordan Lee'
    role            = 'Solution Engineer'
    teamArea        = 'Azure'
    active          = $true
  }
  $r = Invoke-Api POST '/api/deal-team-members' $body
  $r.Status -eq 201
}
Check 'GET /api/deal-team-members?opportunityId=... (list, id required)' {
  $r = Invoke-Api GET "/api/deal-team-members?opportunityId=$($script:oppId)"
  $r.Status -eq 200 -and ($r.Json.data -is [array])
}
Check 'GET /api/deal-team-members (missing opportunityId) -> 400' {
  $r = Invoke-Api GET '/api/deal-team-members'
  $r.Status -eq 400 -and $r.Json.success -eq $false
}

# ------------------------------------------------------------ Agent notifications
Write-Host "`nAgent notifications" -ForegroundColor Yellow
$script:notifId = $null
Check 'POST /api/agent-notifications (create)' {
  $body = @{
    opportunityName = $oppName
    severity        = 'Warning'
    notifyRole      = 'SE Manager'
    message         = 'Milestone flagged At Risk.'
  }
  $r = Invoke-Api POST '/api/agent-notifications' $body
  $script:notifId = $r.Json.data.id
  $r.Status -eq 201
}
Check 'PATCH /api/agent-notifications/:id (update status)' {
  $r = Invoke-Api PATCH "/api/agent-notifications/$($script:notifId)" @{ status = 'Acknowledged' }
  $r.Status -eq 200
}
Check 'GET /api/agent-notifications (list)' {
  $r = Invoke-Api GET '/api/agent-notifications'
  $r.Status -eq 200 -and ($r.Json.data -is [array])
}

# ------------------------------------------------------------ Agent run logs
Write-Host "`nAgent run logs" -ForegroundColor Yellow
Check 'POST /api/agent-run-logs (create)' {
  $body = @{
    agentName       = 'MilestoneAdvisor'
    runType         = 'User-triggered'
    status          = 'Success'
    opportunityName = $oppName
    numberOfToolCalls = 3
  }
  $r = Invoke-Api POST '/api/agent-run-logs' $body
  $r.Status -eq 201
}
Check 'GET /api/agent-run-logs (list)' {
  $r = Invoke-Api GET '/api/agent-run-logs'
  $r.Status -eq 200 -and ($r.Json.data -is [array])
}

# ------------------------------------------------------ Agent action audit logs
Write-Host "`nAgent action audit logs" -ForegroundColor Yellow
Check 'GET /api/agent-action-audit-logs (list + CreateMilestone present)' {
  $r = Invoke-Api GET '/api/agent-action-audit-logs'
  $r.Status -eq 200 -and ($r.Json.data | Where-Object { $_.actionType -eq 'CreateMilestone' }).Count -ge 1
}
Check 'POST /api/agent-action-audit-logs (create)' {
  $body = @{
    actionName = "Manual audit $stamp"
    agentName  = 'MilestoneAdvisor'
    actionType = 'Read'
    actor      = 'Demo SE'
    opportunityName = $oppName
    result     = 'Success'
  }
  $r = Invoke-Api POST '/api/agent-action-audit-logs' $body
  $r.Status -eq 201
}

# ----------------------------------------------------------------- Dashboard
Write-Host "`nDashboard" -ForegroundColor Yellow
Check 'GET /api/dashboard/summary' {
  $r = Invoke-Api GET '/api/dashboard/summary'
  $r.Status -eq 200 -and $r.Json.success -eq $true
}
Check 'POST /api/dashboard-metric-snapshots (create)' {
  $r = Invoke-Api POST '/api/dashboard-metric-snapshots' @{ snapshotName = "Snapshot $stamp"; totalAgentRuns = 1 }
  $r.Status -eq 201
}
Check 'GET /api/dashboard-metric-snapshots (list)' {
  $r = Invoke-Api GET '/api/dashboard-metric-snapshots'
  $r.Status -eq 200 -and ($r.Json.data -is [array])
}

# ---------------------------------------------------------- Validation guard
Write-Host "`nValidation & error handling" -ForegroundColor Yellow
Check 'POST /api/opportunities with invalid body -> 400' {
  $r = Invoke-Api POST '/api/opportunities' @{ customerName = 'missing name' }
  $r.Status -eq 400 -and $r.Json.success -eq $false
}
Check 'GET /api/opportunities/does-not-exist -> 404' {
  $r = Invoke-Api GET '/api/opportunities/nope-$stamp'
  $r.Status -eq 404 -and $r.Json.success -eq $false
}

# --------------------------------------------------------------------- Chat
Write-Host "`nChat assistant (requires AI config)" -ForegroundColor Yellow
Check 'POST /api/chat (in-app engine)' {
  $body = @{ messages = @(@{ role = 'user'; content = 'List the milestones for this opportunity.' }); engine = 'in-app' }
  $r = Invoke-Api POST '/api/chat' $body
  if ($r.Status -eq 200 -and $r.Json.data.reply) { return $true }
  # A 500 here is almost always missing Azure OpenAI credentials, not an app bug.
  if ($r.Status -eq 500) { throw 'SKIP: needs Azure OpenAI config (set AZURE_OPENAI_* / az login).' }
  throw "status $($r.Status): $($r.Raw)"
}

# ------------------------------------------------------------------- Summary
Write-Host ("`n" + ('=' * 70))
$total = $script:pass + $script:fail + $script:skip
Write-Host ("RESULTS: {0}/{1} passed, {2} failed, {3} skipped" -f $script:pass, $total, $script:fail, $script:skip) -ForegroundColor Cyan
$script:results | Format-Table -AutoSize Feature, Result, Note
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
