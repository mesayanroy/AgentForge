#!/bin/bash
# scripts/deploy-remaining-contracts.sh
# Automates compiling, optimizing, deploying, and initializing the remaining 2 AgentForge contracts:
# 1. Execution Manager (linked to Payment Router)
# 2. Agent Wallet (owned by Sayan with spending limit)
# Target: Stellar Mainnet with priority fees & Gateway.fm RPC node.

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${PURPLE}===============================================================${NC}"
echo -e "${PURPLE}     AgentForge Remaining Smart Contracts Deployer (Mainnet)   ${NC}"
echo -e "${PURPLE}===============================================================${NC}"
echo ""

ENV_FILE="/mnt/c/Users/SAYAN/AgentForge/.env.local"
CONTRACTS_DIR="/mnt/c/Users/SAYAN/AgentForge/contracts"
TARGET_NETWORK="mainnet"

# Verify .env.local exists
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}✗ Error: .env.local not found at $ENV_FILE${NC}"
  exit 1
fi

# Load variables
echo -e "${BLUE}▶ Loading credentials from .env.local...${NC}"
STELLAR_AGENT_SECRET=$(grep "^STELLAR_AGENT_SECRET=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '\r\n ')
PAYMENT_ROUTER_ID=$(grep "^PAYMENT_ROUTER_CONTRACT_ID=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '\r\n ')

if [ -z "$STELLAR_AGENT_SECRET" ]; then
  echo -e "${RED}✗ Error: STELLAR_AGENT_SECRET is not set in .env.local!${NC}"
  exit 1
fi

if [ -z "$PAYMENT_ROUTER_ID" ]; then
  echo -e "${RED}✗ Error: PAYMENT_ROUTER_CONTRACT_ID is not set in .env.local!${NC}"
  echo -e "Please ensure the Payment Router has been successfully deployed first."
  exit 1
fi

# Configure temporary keys and network settings in Stellar CLI
echo -e "${BLUE}▶ Configuring deployer signing keys & high-speed network settings...${NC}"
source /root/.cargo/env

stellar network rm mainnet 2>/dev/null || true
stellar network rm testnet 2>/dev/null || true
stellar network add --rpc-url "https://rpc.mainnet.stellar.gateway.fm" --network-passphrase "Public Global Stellar Network ; September 2015" mainnet 2>/dev/null || true
stellar network add --rpc-url "https://soroban-testnet.stellar.org" --network-passphrase "Test SDF Network ; September 2015" testnet 2>/dev/null || true

echo "$STELLAR_AGENT_SECRET" | stellar keys add deployer --overwrite --secret-key > /dev/null

DEPLOYER_PUB=$(stellar keys address deployer)
echo -e "${GREEN}✓ Deployer key loaded successfully!${NC}"
echo -e "  Public Key : ${CYAN}$DEPLOYER_PUB${NC}"
echo -e "  Router Link: ${CYAN}$PAYMENT_ROUTER_ID${NC}"

# Check balance
HORIZON_URL="https://horizon.stellar.org"
echo -e "${BLUE}▶ Querying deployer balance on Horizon...${NC}"
ACCOUNT_JSON=$(curl -s "$HORIZON_URL/accounts/$DEPLOYER_PUB")
BALANCE=$(echo "$ACCOUNT_JSON" | grep -o '"balance":[^,]*' | head -1 | cut -d'"' -f4)
echo -e "${GREEN}✓ Active! Live Balance:${NC} ${YELLOW}$BALANCE XLM${NC}"

# Build all contracts using Native WSL Storage to prevent Windows file locks
echo -e "${BLUE}▶ Triggering optimized release build in native WSL space...${NC}"
cd "$CONTRACTS_DIR"
export CARGO_TARGET_DIR="/tmp/agentforge_target"
echo -e "  Cleaning stale build cache..."
cargo clean
RUSTFLAGS="-C target-feature=-reference-types" cargo build --target wasm32-unknown-unknown --release
echo -e "${GREEN}✓ Cargo build complete! All target WASM files ready.${NC}"

WASM_DIR="/tmp/agentforge_target/wasm32-unknown-unknown/release"

get_current_balance() {
  curl -s "$HORIZON_URL/accounts/$DEPLOYER_PUB" | grep -o '"balance":[^,]*' | head -1 | cut -d'"' -f4
}

update_env_var() {
  local key=$1
  local value=$2
  if grep -q "^$key=" "$ENV_FILE"; then
    sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
  else
    echo "$key=$value" >> "$ENV_FILE"
  fi
}

deploy_contract() {
  local name=$1
  local wasm_file="$WASM_DIR/$name.wasm"
  local optimized_wasm="$WASM_DIR/$name.optimized.wasm"
  
  echo -e "\n${YELLOW}===============================================================${NC}" >&2
  echo -e "  Deploying contract: ${GREEN}$name${NC}" >&2
  echo -e "${YELLOW}===============================================================${NC}" >&2
  
  if [ ! -f "$wasm_file" ]; then
    echo -e "${RED}✗ Error: Compiled wasm file not found: $wasm_file${NC}" >&2
    exit 1
  fi
  
  echo -e "  Optimizing WASM to strip reference-types..." >&2
  stellar contract optimize --wasm "$wasm_file" > /dev/null
  
  local bal_before=$(get_current_balance)
  echo -e "  Stellar balance before: ${YELLOW}$bal_before XLM${NC}" >&2
  
  echo -e "  Uploading WASM & deploying instance (this may take up to 60s)..." >&2
  local contract_id
  contract_id=$(stellar contract deploy \
    --wasm "$optimized_wasm" \
    --source deployer \
    --network "$TARGET_NETWORK" \
    --inclusion-fee 1000000)
    
  local bal_after=$(get_current_balance)
  local cost=$(echo "$bal_before - $bal_after" | bc -l)
  
  echo -e "  ${GREEN}✓ Deployed successfully!${NC}" >&2
  echo -e "  Contract ID: ${CYAN}$contract_id${NC}" >&2
  echo -e "  Actual Gas/Storage Cost: ${YELLOW}$cost XLM${NC}" >&2
  
  echo "$contract_id"
}

STARTING_BALANCE=$(get_current_balance)

# Step 1: Deploy & Initialize Execution Manager
EXECUTION_MANAGER_ID=$(deploy_contract "execution_manager")
bal_before=$(get_current_balance)
echo -e "  Initializing Execution Manager..."
stellar contract invoke \
  --id "$EXECUTION_MANAGER_ID" \
  --source deployer \
  --network "$TARGET_NETWORK" \
  --inclusion-fee 1000000 \
  -- initialize \
  --admin "$DEPLOYER_PUB" \
  --runtime_router "$PAYMENT_ROUTER_ID" > /dev/null
bal_after=$(get_current_balance)
exec_init_cost=$(echo "$bal_before - $bal_after" | bc -l)
echo -e "  ${GREEN}✓ Execution Manager Initialized!${NC} (Cost: ${YELLOW}$exec_init_cost XLM${NC})"

update_env_var "EXECUTION_MANAGER_CONTRACT_ID" "$EXECUTION_MANAGER_ID"


# Step 2: Deploy & Initialize Agent Wallet
AGENT_WALLET_ID=$(deploy_contract "agent_wallet")
bal_before=$(get_current_balance)
echo -e "  Initializing Agent Wallet..."
stellar contract invoke \
  --id "$AGENT_WALLET_ID" \
  --source deployer \
  --network "$TARGET_NETWORK" \
  --inclusion-fee 1000000 \
  -- initialize \
  --owner "$DEPLOYER_PUB" \
  --spend_limit_stroops 5000000000 > /dev/null
bal_after=$(get_current_balance)
wallet_init_cost=$(echo "$bal_before - $bal_after" | bc -l)
echo -e "  ${GREEN}✓ Agent Wallet Initialized!${NC} (Cost: ${YELLOW}$wallet_init_cost XLM${NC})"

update_env_var "AGENT_WALLET_CONTRACT_ID" "$AGENT_WALLET_ID"

# Clean up deployer identity
stellar keys rm deployer --force > /dev/null || true

FINAL_BALANCE=$(get_current_balance)
TOTAL_DEPLOY_COST=$(echo "$STARTING_BALANCE - $FINAL_BALANCE" | bc -l)

echo -e "\n${GREEN}===============================================================${NC}"
echo -e "🎉    REMAINING SMART CONTRACTS DEPLOYED & INITIALIZED!        "
echo -e "${GREEN}===============================================================${NC}"
echo ""
echo -e "📋 ${BLUE}Deployment Summary:${NC}"
echo -e "---------------------------------------------------------------"
echo -e "  Execution Manager ID  : ${CYAN}$EXECUTION_MANAGER_ID${NC}"
echo -e "  Agent Wallet ID       : ${CYAN}$AGENT_WALLET_ID${NC}"
echo -e "---------------------------------------------------------------"
echo -e "  Starting Balance      : ${YELLOW}$STARTING_BALANCE XLM${NC}"
echo -e "  Ending Balance        : ${YELLOW}$FINAL_BALANCE XLM${NC}"
echo -e "  Total Actual Cost     : ${GREEN}$TOTAL_DEPLOY_COST XLM${NC}"
echo -e "---------------------------------------------------------------"
echo -e "  Environment File      : ${GREEN}.env.local successfully updated!${NC}"
echo -e "${GREEN}===============================================================${NC}\n"
