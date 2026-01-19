
# CoWatch Windows 11: one-click build script
$ErrorActionPreference = "Stop"

function Ensure-Winget {
  $wg = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $wg) { Write-Host "winget not found. Please install 'App Installer' from Microsoft Store and re-run." ; exit 1 }
}

function Ensure-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Host "Installing Node.js LTS via winget..."
    winget install OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  } else { Write-Host "Node.js found: $($node.Path)" }
}

Push-Location $PSScriptRoot\..
Ensure-Winget
Ensure-Node

Write-Host "Installing dependencies..."
npm install

Write-Host "Building Windows installer and portable build..."
npm run dist

Write-Host "Done. See the dist/ folder for your installer (.exe) and portable .exe."
Pop-Location
