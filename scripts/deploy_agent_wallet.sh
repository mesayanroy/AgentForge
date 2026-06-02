#!/bin/bash
# scripts/deploy_agent_wallet.sh
# Deploy and initialize Sayan's optimized Agent Wallet on Mainnet

set -euo pipefail

ENV_FILE="/mnt/c/Users/SAYAN/AgentForge/.env.local"
WASM_FILE="/mnt/c/Users/SAYAN/AgentForge/contracts/target/wasm32-unknown-unknown/release/agent_wallet.stripped.wasm"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env.local not found!"
  exit 1
fi

if [ ! -f "$WASM_FILE" ]; then
  echo "Error: Stripped WASM not found at $WASM_FILE"
  exit 1
fi

# Load variables
STELLAR_AGENT_SECRET=$(grep "^STELLAR_AGENT_SECRET=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '\r\n ')

if [ -z "$STELLAR_AGENT_SECRET" ]; then
  echo "Error: STELLAR_AGENT_SECRET is not set in .env.local!"
  exit 1
fi

source /root/.cargo/env

# Setup network configs
stellar network rm mainnet 2>/dev/null || true
stellar network add --rpc-url "https://mainnet.sorobanrpc.com" --network-passphrase "Public Global Stellar Network ; September 2015" mainnet 2>/dev/null || true

stellar keys rm deployer --force 2>/dev/null || true
echo "$STELLAR_AGENT_SECRET" | stellar keys add deployer --secret-key > /dev/null

DEPLOYER_PUB=$(stellar keys address deployer)
echo "Deployer Address: $DEPLOYER_PUB"

echo "Deploying optimized Agent Wallet to Stellar Mainnet..."
AGENT_WALLET_ID=$(stellar contract deploy \
  --wasm "$WASM_FILE" \
  --source deployer \
  --network mainnet \
  --inclusion-fee 5000000)

echo "Agent Wallet Contract ID: $AGENT_WALLET_ID"

echo "Initializing Agent Wallet..."
stellar contract invoke \
  --id "$AGENT_WALLET_ID" \
  --source deployer \
  --network mainnet \
  --inclusion-fee 5000000 \
  -- initialize \
  --owner "$DEPLOYER_PUB"

echo "Contract initialized successfully!"
echo "SUCCESS_CONTRACT_ID=$AGENT_WALLET_ID"
