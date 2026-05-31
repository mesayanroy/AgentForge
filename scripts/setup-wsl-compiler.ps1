# scripts/setup-wsl-compiler.ps1
# Automates the setup of Rust, Cargo, wasm32 target, and Stellar CLI inside WSL Ubuntu-24.04

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       AgentForge WSL Contract Toolchain Installer             ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Step 1: Install standard Ubuntu build dependencies
Write-Host "  Step 1: Installing Ubuntu build dependencies..." -ForegroundColor Yellow
wsl -u root -d Ubuntu-24.04 -- apt-get update
wsl -u root -d Ubuntu-24.04 -- apt-get install -y curl build-essential git libssl-dev pkg-config ca-certificates

# Step 2: Install Rust compiler and wasm32 target
Write-Host "  Step 2: Installing Rustup & wasm32 target..." -ForegroundColor Yellow
wsl -u root -d Ubuntu-24.04 -- bash -c "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable"
wsl -u root -d Ubuntu-24.04 -- bash -c "source `$HOME/.cargo/env && rustup target add wasm32-unknown-unknown"

# Step 3: Install/Download precompiled Stellar CLI for Linux
Write-Host "  Step 3: Fetching and configuring Stellar CLI..." -ForegroundColor Yellow
# We pull a stable release (e.g. v21.6.0 or similar) from official sources
$cliUrl = "https://github.com/stellar/stellar-cli/releases/download/v21.6.0/stellar-cli-v21.6.0-x86_64-unknown-linux-gnu.tar.gz"
Write-Host "          Downloading from: $cliUrl" -ForegroundColor Gray
wsl -u root -d Ubuntu-24.04 -- bash -c "curl -L -o /tmp/stellar-cli.tar.gz $cliUrl"
wsl -u root -d Ubuntu-24.04 -- bash -c "tar -xzf /tmp/stellar-cli.tar.gz -C /tmp && mv /tmp/stellar-cli/stellar /usr/local/bin/stellar && chmod +x /usr/local/bin/stellar"

# Step 4: Verify installations
Write-Host "  Step 4: Verifying compiler and CLI binaries..." -ForegroundColor Yellow
$cargoVer = wsl -u root -d Ubuntu-24.04 -- bash -c "source `$HOME/.cargo/env && cargo --version"
$stellarVer = wsl -u root -d Ubuntu-24.04 -- stellar --version

Write-Host "          Cargo version   : $cargoVer" -ForegroundColor White
Write-Host "          Stellar version : $stellarVer" -ForegroundColor White

Write-Host ""
Write-Host "🎉 WSL Toolchain installation successfully completed!" -ForegroundColor Green
Write-Host "   You can now compile and deploy Soroban contracts on Stellar Mainnet." -ForegroundColor Green
Write-Host ""
