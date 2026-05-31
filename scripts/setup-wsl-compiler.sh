#!/bin/bash
# scripts/setup-wsl-compiler.sh
# Automates the setup of Rust, Cargo, wasm32 target, and Stellar CLI inside WSL Ubuntu-24.04

set -euo pipefail

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║       AgentForge WSL Contract Toolchain Installer             ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

echo "  Step 1: Installing Ubuntu build dependencies..."
apt-get update
apt-get install -y curl build-essential git libssl-dev pkg-config ca-certificates

echo "  Step 2: Installing Rustup & wasm32 target..."
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
source $HOME/.cargo/env
rustup target add wasm32-unknown-unknown

echo "  Step 3: Fetching and configuring Stellar CLI..."
curl -fsSL https://raw.githubusercontent.com/stellar/stellar-cli/main/install.sh | sh

echo "  Step 4: Verifying compiler and CLI binaries..."
cargo_ver=$(cargo --version)
stellar_ver=$(stellar --version)

echo "          Cargo version   : $cargo_ver"
echo "          Stellar version : $stellar_ver"

echo ""
echo "🎉 WSL Toolchain installation successfully completed!"
echo ""
