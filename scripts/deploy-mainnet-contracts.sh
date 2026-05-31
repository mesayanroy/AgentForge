#!/bin/bash
# scripts/deploy-mainnet-contracts.sh
# Automates compiling, deploying, and initializing all 6 AgentForge Soroban contracts sequentially.
# Keeps track of live balances and costs, updating .env.local automatically.

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${PURPLE}===============================================================${NC}"
echo -e "${PURPLE}        AgentForge Stellar Contract Deployment Engine          ${NC}"
echo -e "${PURPLE}===============================================================${NC}"
echo ""

# Configuration paths
ENV_FILE="/mnt/c/Users/SAYAN/AgentForge/.env.local"
CONTRACTS_DIR="/mnt/c/Users/SAYAN/AgentForge/contracts"

TARGET_NETWORK="mainnet"

# Check for override network argument (e.g. --network testnet)
if [ "${1:-}" = "--network" ] && [ -n "${2:-}" ]; then
  TARGET_NETWORK="$2"
  shift 2
fi

echo -e "${BLUE}▶ Target Network:${NC} $TARGET_NETWORK"

# Verify .env.local exists
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}✗ Error: .env.local not found at $ENV_FILE${NC}"
  exit 1
fi

# Load variables
echo -e "${BLUE}▶ Loading credentials from .env.local...${NC}"
STELLAR_AGENT_SECRET=$(grep "^STELLAR_AGENT_SECRET=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '\r\n ')

if [ -z "$STELLAR_AGENT_SECRET" ]; then
  echo -e "${RED}✗ Error: STELLAR_AGENT_SECRET is not set in .env.local!${NC}"
  echo -e "${YELLOW}Please add your Stellar private key starting with 'S' to .env.local and try again.${NC}"
  exit 1
fi

# Initialize temporary Stellar CLI identity & networks
echo -e "${BLUE}▶ Configuring deployer signing keys & network settings...${NC}"
source /root/.cargo/env
stellar network add --rpc-url "https://mainnet.sorobanrpc.com" --network-passphrase "Public Global Stellar Network ; September 2015" mainnet 2>/dev/null || true
stellar network add --rpc-url "https://soroban-testnet.stellar.org" --network-passphrase "Test SDF Network ; September 2015" testnet 2>/dev/null || true
echo "$STELLAR_AGENT_SECRET" | stellar keys add deployer --overwrite --secret-key > /dev/null

DEPLOYER_PUB=$(stellar keys address deployer)
echo -e "${GREEN}✓ Deployer key loaded successfully!${NC}"
echo -e "  Public Key: ${CYAN}$DEPLOYER_PUB${NC}"

# Establish Horizon URL based on network selection
HORIZON_URL="https://horizon.stellar.org"
if [ "$TARGET_NETWORK" = "testnet" ]; then
  HORIZON_URL="https://horizon-testnet.stellar.org"
fi

# Check account state and balance
echo -e "${BLUE}▶ Querying deployer balance on Horizon ($TARGET_NETWORK)...${NC}"
ACCOUNT_JSON=$(curl -s "$HORIZON_URL/accounts/$DEPLOYER_PUB")

if echo "$ACCOUNT_JSON" | grep -q "not_found"; then
  echo -e "${RED}✗ Error: Deployer account is NOT funded or active on $TARGET_NETWORK!${NC}"
  echo -e "  Derived Public Address: ${CYAN}$DEPLOYER_PUB${NC}"
  echo -e "${YELLOW}Please update STELLAR_AGENT_SECRET in .env.local with the secret key${NC}"
  echo -e "${YELLOW}of your active, funded mainnet account (e.g. Freighter: GARN7A6OJKPR3HAPVIKM6GRUD7KMEHYQ76VJJCO4AAKQ6ETEKFQPQ24T).${NC}"
  exit 1
fi

# Parse balance
BALANCE=$(echo "$ACCOUNT_JSON" | grep -o '"balance":[^,]*' | head -1 | cut -d'"' -f4)
echo -e "${GREEN}✓ Deployer account active! Live Balance:${NC} ${YELLOW}$BALANCE XLM${NC}"

# Build all contracts in cargo workspace to ensure binaries are fully updated
echo -e "${BLUE}▶ Triggering optimized release build for all contracts...${NC}"
cd "$CONTRACTS_DIR"
echo -e "  Cleaning stale build cache..."
cargo clean
RUSTFLAGS="-C target-feature=-reference-types" cargo build --target wasm32-unknown-unknown --release
echo -e "${GREEN}✓ Cargo build complete! All target WASM files ready.${NC}"

# Path to the compiled wasm binaries
WASM_DIR="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release"

# Function to query current balance
get_current_balance() {
  curl -s "$HORIZON_URL/accounts/$DEPLOYER_PUB" | grep -o '"balance":[^,]*' | head -1 | cut -d'"' -f4
}

# Function to update variable in .env.local
update_env_var() {
  local key=$1
  local value=$2
  
  if grep -q "^$key=" "$ENV_FILE"; then
    sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
  else
    echo "$key=$value" >> "$ENV_FILE"
  fi
}

# Deployment helper function
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
  
  if [ ! -f "$optimized_wasm" ]; then
    echo -e "${RED}✗ Error: Optimized wasm file not generated: $optimized_wasm${NC}" >&2
    exit 1
  fi
  
  local bal_before=$(get_current_balance)
  echo -e "  Stellar balance before: ${YELLOW}$bal_before XLM${NC}" >&2
  
  echo -e "  Uploading WASM & deploying instance (this may take up to 60s)..." >&2
  local contract_id
  contract_id=$(stellar contract deploy \
    --wasm "$optimized_wasm" \
    --source deployer \
    --network "$TARGET_NETWORK")
    
  local bal_after=$(get_current_balance)
  local cost=$(echo "$bal_before - $bal_after" | bc -l)
  
  echo -e "  ${GREEN}✓ Deployed successfully!${NC}" >&2
  echo -e "  Contract ID: ${CYAN}$contract_id${NC}" >&2
  echo -e "  Actual Gas/Storage Cost: ${YELLOW}$cost XLM${NC}" >&2
  
  echo "$contract_id"
}

# Array to keep track of costs
declare -A DEPLOYMENT_COSTS
TOTAL_DEPLOY_COST=0

# Step 1: Deploy & Initialize AF Token
AF_TOKEN_ID=$(deploy_contract "af_token")
bal_before=$(get_current_balance)
echo -e "  Initializing AF Token..."
stellar contract invoke \
  --id "$AF_TOKEN_ID" \
  --source deployer \
  --network "$TARGET_NETWORK" \
  -- initialize \
  --admin "$DEPLOYER_PUB" > /dev/null
bal_after=$(get_current_balance)
init_cost=$(echo "$bal_before - $bal_after" | bc -l)
echo -e "  ${GREEN}✓ AF Token Initialized!${NC} (Cost: ${YELLOW}$init_cost XLM${NC})"

update_env_var "AF_TOKEN_CONTRACT_ID" "$AF_TOKEN_ID"
update_env_var "NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID" "$AF_TOKEN_ID"


# Step 2: Circularly Deploy Agent Registry and Agent Validator
REGISTRY_ID=$(deploy_contract "agent_registry")
VALIDATOR_ID=$(deploy_contract "agent_validator")

# Initialize registry linking to validator
bal_before=$(get_current_balance)
echo -e "  Initializing Agent Registry (linking to validator)..."
stellar contract invoke \
  --id "$REGISTRY_ID" \
  --source deployer \
  --network "$TARGET_NETWORK" \
  -- initialize \
  --admin "$DEPLOYER_PUB" \
  --validator "$VALIDATOR_ID" > /dev/null
bal_after=$(get_current_balance)
reg_init_cost=$(echo "$bal_before - $bal_after" | bc -l)
echo -e "  ${GREEN}✓ Agent Registry Initialized!${NC} (Cost: ${YELLOW}$reg_init_cost XLM${NC})"

update_env_var "AGENT_REGISTRY_CONTRACT_ID" "$REGISTRY_ID"
update_env_var "NEXT_PUBLIC_SOROBAN_CONTRACT_ID" "$REGISTRY_ID"

# Initialize validator linking to registry with 5 XLM fee (50_000_000 stroops)
bal_before=$(get_current_balance)
echo -e "  Initializing Agent Validator (linking to registry)..."
stellar contract invoke \
  --id "$VALIDATOR_ID" \
  --source deployer \
  --network "$TARGET_NETWORK" \
  -- initialize \
  --admin "$DEPLOYER_PUB" \
  --registry "$REGISTRY_ID" \
  --fee_stroops 50000000 > /dev/null
bal_after=$(get_current_balance)
val_init_cost=$(echo "$bal_before - $bal_after" | bc -l)
echo -e "  ${GREEN}✓ Agent Validator Initialized!${NC} (Cost: ${YELLOW}$val_init_cost XLM${NC})"

update_env_var "AGENT_VALIDATOR_CONTRACT_ID" "$VALIDATOR_ID"
update_env_var "NEXT_PUBLIC_SOROBAN_VALIDATOR_ID" "$VALIDATOR_ID"


# Step 3: Deploy & Initialize Payment Router
PAYMENT_ROUTER_ID=$(deploy_contract "payment_router")
bal_before=$(get_current_balance)
echo -e "  Initializing Payment Router..."
stellar contract invoke \
  --id "$PAYMENT_ROUTER_ID" \
  --source deployer \
  --network "$TARGET_NETWORK" \
  -- initialize \
  --admin "$DEPLOYER_PUB" \
  --protocol_fee_bps 100 \
  --execution_fee_bps 100 \
  --workflow_fee_bps 100 > /dev/null
bal_after=$(get_current_balance)
router_init_cost=$(echo "$bal_before - $bal_after" | bc -l)
echo -e "  ${GREEN}✓ Payment Router Initialized!${NC} (Cost: ${YELLOW}$router_init_cost XLM${NC})"

update_env_var "PAYMENT_ROUTER_CONTRACT_ID" "$PAYMENT_ROUTER_ID"


# Step 4: Deploy & Initialize Execution Manager linked to Payment Router
EXECUTION_MANAGER_ID=$(deploy_contract "execution_manager")
bal_before=$(get_current_balance)
echo -e "  Initializing Execution Manager..."
stellar contract invoke \
  --id "$EXECUTION_MANAGER_ID" \
  --source deployer \
  --network "$TARGET_NETWORK" \
  -- initialize \
  --admin "$DEPLOYER_PUB" \
  --runtime_router "$PAYMENT_ROUTER_ID" > /dev/null
bal_after=$(get_current_balance)
exec_init_cost=$(echo "$bal_before - $bal_after" | bc -l)
echo -e "  ${GREEN}✓ Execution Manager Initialized!${NC} (Cost: ${YELLOW}$exec_init_cost XLM${NC})"

update_env_var "EXECUTION_MANAGER_CONTRACT_ID" "$EXECUTION_MANAGER_ID"


# Step 5: Deploy & Initialize Agent Wallet owned by deployer (Sayan) with 500 XLM spending limit
AGENT_WALLET_ID=$(deploy_contract "agent_wallet")
bal_before=$(get_current_balance)
echo -e "  Initializing Agent Wallet..."
stellar contract invoke \
  --id "$AGENT_WALLET_ID" \
  --source deployer \
  --network "$TARGET_NETWORK" \
  -- initialize \
  --owner "$DEPLOYER_PUB" \
  --spend_limit_stroops 5000000000 > /dev/null
bal_after=$(get_current_balance)
wallet_init_cost=$(echo "$bal_before - $bal_after" | bc -l)
echo -e "  ${GREEN}✓ Agent Wallet Initialized!${NC} (Cost: ${YELLOW}$wallet_init_cost XLM${NC})"

update_env_var "AGENT_WALLET_CONTRACT_ID" "$AGENT_WALLET_ID"

# Clean up deployer identity
stellar keys rm deployer --force > /dev/null || true

# Final balance query
FINAL_BALANCE=$(get_current_balance)
TOTAL_DEPLOY_COST=$(echo "$BALANCE - $FINAL_BALANCE" | bc -l)

echo -e "\n${GREEN}===============================================================${NC}"
echo -e "🎉       ALL 6 SMART CONTRACTS SUCCESSFULLY DEPLOYED!          "
echo -e "${GREEN}===============================================================${NC}"
echo ""
echo -e "📋 ${BLUE}Deployment Summary:${NC}"
echo -e "---------------------------------------------------------------"
echo -e "  AF Token ID           : ${CYAN}$AF_TOKEN_ID${NC}"
echo -e "  Agent Registry ID     : ${CYAN}$REGISTRY_ID${NC}"
echo -e "  Agent Validator ID    : ${CYAN}$VALIDATOR_ID${NC}"
echo -e "  Payment Router ID     : ${CYAN}$PAYMENT_ROUTER_ID${NC}"
echo -e "  Execution Manager ID  : ${CYAN}$EXECUTION_MANAGER_ID${NC}"
echo -e "  Agent Wallet ID       : ${CYAN}$AGENT_WALLET_ID${NC}"
echo -e "---------------------------------------------------------------"
echo -e "  Starting Balance      : ${YELLOW}$BALANCE XLM${NC}"
echo -e "  Ending Balance        : ${YELLOW}$FINAL_BALANCE XLM${NC}"
echo -e "  Total Actual Cost     : ${GREEN}$TOTAL_DEPLOY_COST XLM${NC}"
echo -e "---------------------------------------------------------------"
echo -e "  Environment File      : ${GREEN}.env.local successfully updated!${NC}"
echo ""
echo -e "  Next Step: Start live paper trading using Sayan's updated credentials!"
echo -e "${GREEN}===============================================================${NC}\n"
