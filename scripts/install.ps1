# InterShader Windows Installation Script (Hermes Agent Style)
# Requirements: Windows 10/11, PowerShell 5.1+, Node.js >= 20.0.0, Git

$ErrorActionPreference = "Stop"

Write-Host "`n+---------------------------------------------------------------+" -ForegroundColor DarkYellow
Write-Host "|  ##### #   # ##### ##### ####   #### #   #  ###  ####  #####  |" -ForegroundColor DarkYellow
Write-Host "|    #   ##  #   #   #     #   # #     #   # #   # #   # #      |" -ForegroundColor DarkYellow
Write-Host "|    #   # # #   #   ####  ####   ###  ##### ##### #   # ####   |" -ForegroundColor DarkYellow
Write-Host "|    #   #  ##   #   #     # #       # #   # #   # #   # #      |" -ForegroundColor DarkYellow
Write-Host "|  ##### #   #   #   ##### #  ## ####  #   # #   # ####  #####  |" -ForegroundColor DarkYellow
Write-Host "|                                                               |" -ForegroundColor DarkYellow
Write-Host "|                          Wang Do Lin                          |" -ForegroundColor DarkYellow
Write-Host "|                         Agentic Coding                        |" -ForegroundColor DarkYellow
Write-Host "+---------------------------------------------------------------+`n" -ForegroundColor DarkYellow

Write-Host ">>> Starting InterShader Installation on Windows..." -ForegroundColor Cyan

# 1. Check Node.js
try {
    $nodeVersionRaw = node -v
    $nodeMajor = [int]($nodeVersionRaw.TrimStart('v').Split('.')[0])
    if ($nodeMajor -lt 20) {
        Write-Error "Requires Node.js >= v20.0.0. Current version: $nodeVersionRaw. Please update Node.js."
    }
    Write-Host "[OK] Node.js satisfied: $nodeVersionRaw" -ForegroundColor Green
} catch {
    Write-Error "Node.js is not installed or not found on PATH. Please install Node.js from https://nodejs.org"
}

# 2. Check Git
try {
    $gitVersion = git --version
    Write-Host "[OK] Git satisfied: $gitVersion" -ForegroundColor Green
} catch {
    Write-Warning "Git not found on PATH. Worktree Isolation features may be limited."
}

# 3. Install dependencies & build production bundle
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

Push-Location $projectRoot
try {
    Write-Host "`n>>> Checking dependencies..." -ForegroundColor Cyan
    if (-not (Test-Path "node_modules")) {
        Write-Host "Running npm install..." -ForegroundColor Yellow
        npm install
    } else {
        Write-Host "[OK] node_modules directory exists." -ForegroundColor Green
    }

    Write-Host "`n>>> Compiling production bundle (tsup)..." -ForegroundColor Cyan
    npm run build

    # 4. Register global commands (npm link) to support both 'intershader' and 'intershade'
    Write-Host "`n>>> Registering global CLI commands (npm link)..." -ForegroundColor Cyan
    try {
        npm link
        Write-Host "[OK] Successfully registered global commands: 'intershader' and 'intershade'!" -ForegroundColor Green
    } catch {
        Write-Warning "npm link requires Administrator permissions or Developer Mode. You can still run directly: node dist/index.js"
    }

    # 5. Launch Onboarding Setup Wizard
    Write-Host "`n>>> Launching Onboarding Setup Wizard..." -ForegroundColor Cyan
    node dist/index.js setup
} finally {
    Pop-Location
}

Write-Host "`n>>> INSTALLATION COMPLETE!" -ForegroundColor Green
Write-Host "You can now run InterShader from any terminal:" -ForegroundColor Cyan
Write-Host "   intershader" -ForegroundColor Yellow
Write-Host "   intershade" -ForegroundColor Yellow
Write-Host "   intershader /doctor`n" -ForegroundColor Yellow
