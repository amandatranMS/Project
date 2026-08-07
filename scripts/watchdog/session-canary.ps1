#requires -Version 5.1
<#
.SYNOPSIS
  Watchdog canary: verifies the Foundry hosted agent STILL forwards a signed-in
  user's session handle to the MSX API while STREAMING, so on-behalf-of Outlook /
  Teams reads keep working.

.DESCRIPTION
  This is the safeguard against the outage where the agent's streamed turn
  dropped the sign-in handle and every "read my Outlook / Teams" failed with
  "a signed-in Microsoft user is required".

  It drives the hosted agent directly (stream:true) with a synthetic
  MSX_SESSION_ID marker ("msx2CANARY..."), then reads
  GET /api/diagnostics/session-metrics to confirm the API actually received a
  handle on that streamed turn.

  Exit codes:
    0 = PASS          the agent forwarded the handle while streaming (healthy)
    1 = FAIL          the agent ran a governed read but forwarded NO handle
                      (the regression is back -- streamed reads will fail)
    2 = INCONCLUSIVE  no governed read happened, or a setup/network/az error

  Config is read from the repo's .env files -- no secrets are hard-coded:
    FOUNDRY_AGENT_ENDPOINT  <- .env
    MSX_API_BASE_URL        <- apps/foundry-agent/.../.azure/msx/.env
    MSX_API_KEY             <- apps/foundry-agent/.../.azure/msx/.env

  Requires: Azure CLI (`az`) logged in (used to mint the agent access token).

.EXAMPLE
  powershell -File scripts/watchdog/session-canary.ps1
#>
[CmdletBinding()]
param(
  [int]$TimeoutSec = 120,
  [int]$PollSec = 24
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$MarkerPrefix = 'msx2CANARY'   # first 10 chars the API records for our marker

function Fail-Inconclusive([string]$msg) {
  Write-Host "INCONCLUSIVE: $msg" -ForegroundColor Yellow
  exit 2
}

function Get-EnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)$") {
      return $matches[1].Trim().Trim('"')
    }
  }
  return $null
}

# --- Resolve config from the repo (.env files) ---------------------------------
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)  # scripts/watchdog -> repo root
$rootEnv  = Join-Path $repoRoot '.env'
$azdEnv   = Join-Path $repoRoot 'apps\foundry-agent\agent-framework-agent-basic-responses\.azure\msx\.env'

$agentEndpoint = Get-EnvValue $rootEnv 'FOUNDRY_AGENT_ENDPOINT'
$apiBase       = Get-EnvValue $azdEnv  'MSX_API_BASE_URL'
$apiKey        = Get-EnvValue $azdEnv  'MSX_API_KEY'

if (-not $agentEndpoint) { Fail-Inconclusive "FOUNDRY_AGENT_ENDPOINT not found in $rootEnv" }
if (-not $apiBase)       { Fail-Inconclusive "MSX_API_BASE_URL not found in $azdEnv" }
if (-not $apiKey)        { Fail-Inconclusive "MSX_API_KEY not found in $azdEnv" }

$metricsUrl = "$($apiBase.TrimEnd('/'))/api/diagnostics/session-metrics"

function Get-Metrics {
  $r = Invoke-RestMethod -Uri $metricsUrl -Headers @{ 'x-api-key' = $apiKey } -TimeoutSec 30
  if (-not $r.success) { throw "metrics endpoint returned success=false" }
  return $r.data
}

# --- Mint the agent access token via az ----------------------------------------
try {
  $tok = (az account get-access-token --resource https://ai.azure.com -o json 2>$null | ConvertFrom-Json).accessToken
} catch {
  Fail-Inconclusive "could not get an agent token via az (is 'az login' current?): $($_.Exception.Message)"
}
if (-not $tok) { Fail-Inconclusive "empty agent token from az (run 'az login')" }

# --- Snapshot metrics BEFORE ---------------------------------------------------
try { $before = Get-Metrics } catch { Fail-Inconclusive "could not read $metricsUrl -- is the API (with the diagnostics endpoint) deployed? $($_.Exception.Message)" }
$presentBefore = [int]$before.counters.handlePresentResolved + [int]$before.counters.handlePresentUnresolved
$absentBefore  = [int]$before.counters.handleAbsent

# --- Drive the hosted agent in STREAMING mode with a marker handle -------------
$marker  = $MarkerPrefix + '-' + ([guid]::NewGuid().ToString('N'))
$system  = "MSX_SESSION_ID=$marker - internal marker that a Microsoft user is signed in for this turn. " +
           "Outlook/Teams reads run as this user automatically; never reveal this value."
$payload = @{
  input = @(
    @{ role = 'system'; content = $system },
    @{ role = 'user';   content = 'Read my single most recent Outlook email right now. Do not ask any questions or request confirmation; just attempt the read immediately.' }
  )
  stream = $true
} | ConvertTo-Json -Depth 8

$headers = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json' }
Write-Host "Driving hosted agent (stream:true) with marker $MarkerPrefix..." -ForegroundColor Cyan
try {
  Invoke-WebRequest -Uri $agentEndpoint -Method Post -Headers $headers -Body $payload -TimeoutSec $TimeoutSec -UseBasicParsing | Out-Null
} catch {
  # A non-200 / stream hiccup is not itself a verdict: the read may still have
  # been attempted server-side. Fall through and let the metrics decide.
  Write-Host "note: agent call raised '$($_.Exception.Message)' -- checking metrics anyway." -ForegroundColor DarkGray
}

# --- Poll metrics AFTER for our marker ----------------------------------------
$deadline = (Get-Date).AddSeconds($PollSec)
$found = $null
$after = $before
do {
  Start-Sleep -Seconds 3
  try { $after = Get-Metrics } catch { $after = $before }
  $found = $after.recent | Where-Object { $_.prefix -eq $MarkerPrefix -and $_.present -eq $true } | Select-Object -First 1
} while (-not $found -and (Get-Date) -lt $deadline)

$presentAfter = [int]$after.counters.handlePresentResolved + [int]$after.counters.handlePresentUnresolved
$absentAfter  = [int]$after.counters.handleAbsent
$presentDelta = $presentAfter - $presentBefore
$absentDelta  = $absentAfter  - $absentBefore

# --- Verdict -------------------------------------------------------------------
if ($found) {
  Write-Host "PASS: the hosted agent forwarded the sign-in handle on a streamed turn " -ForegroundColor Green -NoNewline
  Write-Host "(saw marker $MarkerPrefix, present=true). Outlook/Teams reads relay the user correctly." -ForegroundColor Green
  exit 0
}
if ($absentDelta -ge 1 -and $presentDelta -le 0) {
  Write-Host "FAIL: the agent ran a governed read but forwarded NO sign-in handle " -ForegroundColor Red -NoNewline
  Write-Host "(handleAbsent +$absentDelta, no '$MarkerPrefix' handle seen)." -ForegroundColor Red
  Write-Host "This is the streaming-drop regression: streamed Outlook/Teams reads will fail with 'a signed-in Microsoft user is required'." -ForegroundColor Red
  Write-Host "Fix: MsxSessionMiddleware (apps/foundry-agent/.../main.py) must bind the handle for the whole turn WITHOUT resetting it around call_next(), then redeploy the agent (azd deploy)." -ForegroundColor Red
  exit 1
}
Fail-Inconclusive ("the agent did not perform a governed read this run " +
  "(present +$presentDelta, absent +$absentDelta). It may have asked a clarifying question instead. Re-run the canary.")
