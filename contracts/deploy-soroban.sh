#!/bin/bash

# ╔════════════════════════════════════════════════════════════════════════════╗
# ║          AgentForge Soroban Contract Deployment Script                     ║
# ║                                                                            ║
# ║  Professional deployment of AgentValidator & AgentRegistry to Stellar     ║
# ║  Testnet. Builds, deploys, initializes, and stores contract IDs in       ║
# ║  .env.local for seamless API integration.                                 ║
# ╚════════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

STELLAR_ACCOUNT="${STELLAR_ACCOUNT:-alice}"
STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"
HORIZON_URL="https://horizon-testnet.stellar.org"
RPC_URL="https://soroban-testnet.stellar.org"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"

# Allow passing "mainnet" as first arg to switch endpoints
if [ "${1:-}" = "mainnet" ]; then
  STELLAR_NETWORK="public"
  HORIZON_URL="https://horizon.stellar.org"
  RPC_URL="https://soroban-rpc.stellar.org"
  NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
fi

# ─────────────────────────────────────────────────────────────────────────────
# UTILITY FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

log_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1"
}

log_step() {
  echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}▶${NC} $1"
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

# Check if stellar CLI is available
check_stellar_cli() {
  if ! command -v stellar &> /dev/null; then
    log_error "Stellar CLI not found! Please install it from https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup"
    exit 1
  fi
  log_success "Stellar CLI found: $(stellar --version | head -1)"
}

# Get admin/deployer address
get_deployer_address() {
  stellar keys public-key "$STELLAR_ACCOUNT" 2>/dev/null || {
    log_error "Failed to get address for account '$STELLAR_ACCOUNT'"
    echo "Make sure your Stellar account is configured. Run: stellar keys show $STELLAR_ACCOUNT"
    exit 1
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# BUILD PHASE
# ─────────────────────────────────────────────────────────────────────────────

build_agent_registry() {
  log_step "Building AgentRegistry contract"

  cd "$PROJECT_ROOT/contracts/agent_registry"
  
  if [ ! -f "Cargo.toml" ]; then
    log_error "Cargo.toml not found in agent_registry directory"
    exit 1
  fi

  stellar contract build --optimize --package agent-registry

  REGISTRY_WASM="target/wasm32v1-none/release/agent_registry.wasm"
  
  if [ ! -f "$REGISTRY_WASM" ]; then
    log_error "AgentRegistry WASM build failed"
    exit 1
  fi

  log_success "AgentRegistry built: $(du -h "$REGISTRY_WASM" | cut -f1)"
  cd "$PROJECT_ROOT"
}

build_agent_validator() {
  log_step "Building AgentValidator contract"

  cd "$PROJECT_ROOT/contracts/agent_validator"

  if [ ! -f "Cargo.toml" ]; then
    log_error "Cargo.toml not found in agent_validator directory"
    exit 1
  fi

  stellar contract build --optimize --package agent-validator

  VALIDATOR_WASM="target/wasm32v1-none/release/agent_validator.wasm"

  if [ ! -f "$VALIDATOR_WASM" ]; then
    log_error "AgentValidator WASM build failed"
    exit 1
  fi

  log_success "AgentValidator built: $(du -h "$VALIDATOR_WASM" | cut -f1)"
  cd "$PROJECT_ROOT"
}

build_af_token() {
  log_step "Building AF Token contract"

  cd "$PROJECT_ROOT/contracts/af_token"

  if [ ! -f "Cargo.toml" ]; then
    log_error "Cargo.toml not found in af_token directory"
    exit 1
  fi

  stellar contract build --optimize --package af-token

  AF_WASM="target/wasm32v1-none/release/af_token.wasm"

  if [ ! -f "$AF_WASM" ]; then
    log_error "AF Token WASM build failed"
    exit 1
  fi

  log_success "AF Token built: $(du -h "$AF_WASM" | cut -f1)"
  cd "$PROJECT_ROOT"
}

# ─────────────────────────────────────────────────────────────────────────────
# DEPLOYMENT PHASE
# ─────────────────────────────────────────────────────────────────────────────

deploy_registry() {
  log_step "Deploying AgentRegistry to Stellar $STELLAR_NETWORK"

  REGISTRY_WASM="$PROJECT_ROOT/contracts/agent_registry/target/wasm32v1-none/release/agent_registry.wasm"

  log_info "Deploying WASM (this may take 30-60 seconds)..."
  
  REGISTRY_ID=$(stellar contract deploy \
    --wasm "$REGISTRY_WASM" \
    --source "$STELLAR_ACCOUNT" \
    --network "$STELLAR_NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE")

  if [ -z "$REGISTRY_ID" ]; then
    log_error "Failed to deploy AgentRegistry"
    exit 1
  fi

  log_success "AgentRegistry deployed!"
  log_info "Contract ID: $REGISTRY_ID"

  echo "$REGISTRY_ID"
}

deploy_validator() {
  log_step "Deploying AgentValidator to Stellar $STELLAR_NETWORK"

  VALIDATOR_WASM="$PROJECT_ROOT/contracts/agent_validator/target/wasm32v1-none/release/agent_validator.wasm"

  log_info "Deploying WASM (this may take 30-60 seconds)..."

  VALIDATOR_ID=$(stellar contract deploy \
    --wasm "$VALIDATOR_WASM" \
    --source "$STELLAR_ACCOUNT" \
    --network "$STELLAR_NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE")

  if [ -z "$VALIDATOR_ID" ]; then
    log_error "Failed to deploy AgentValidator"
    exit 1
  fi

  log_success "AgentValidator deployed!"
  log_info "Contract ID: $VALIDATOR_ID"

  echo "$VALIDATOR_ID"
}

deploy_af_token() {
  log_step "Deploying AF Token to Stellar $STELLAR_NETWORK"

  AF_WASM="$PROJECT_ROOT/contracts/af_token/target/wasm32v1-none/release/af_token.wasm"

  log_info "Deploying WASM (this may take 30-60 seconds)..."

  AF_ID=$(stellar contract deploy \
    --wasm "$AF_WASM" \
    --source "$STELLAR_ACCOUNT" \
    --network "$STELLAR_NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE")

  if [ -z "$AF_ID" ]; then
    log_error "Failed to deploy AF Token"
    exit 1
  fi

  log_success "AF Token deployed!"
  log_info "Contract ID: $AF_ID"

  echo "$AF_ID"
}

# ─────────────────────────────────────────────────────────────────────────────
# INITIALIZATION PHASE
# ─────────────────────────────────────────────────────────────────────────────

initialize_registry() {
  local registry_id=$1
  local admin=$2

  log_step "Initializing AgentRegistry"

  log_info "Calling registry.initialize(admin=$admin)"

  stellar contract invoke \
    --id "$registry_id" \
    --source-account "$STELLAR_ACCOUNT" \
    --network "$STELLAR_NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- initialize \
    --admin "$admin" \
    --validator "$3" > /dev/null

  log_success "AgentRegistry initialized"
}

initialize_validator() {
  local validator_id=$1
  local admin=$2
  local registry_id=$3

  log_step "Initializing AgentValidator"

  # Fee = 5 XLM = 50,000,000 stroops
  local fee_stroops="50000000"

  log_info "Calling validator.initialize(admin=$admin, registry=$registry_id, fee=$fee_stroops stroops)"

  stellar contract invoke \
    --id "$validator_id" \
    --source-account "$STELLAR_ACCOUNT" \
    --network "$STELLAR_NETWORK" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- initialize \
    --admin "$admin" \
    --registry "$registry_id" \
    --fee-stroops "$fee_stroops" > /dev/null

  log_success "AgentValidator initialized with 5 XLM fee"
}

# ─────────────────────────────────────────────────────────────────────────────
# .ENV.LOCAL UPDATE
# ─────────────────────────────────────────────────────────────────────────────

update_env_local() {
  local registry_id=$1
  local validator_id=$2
  local af_id=${3:-}
  local env_file="$PROJECT_ROOT/.env.local"

  log_step "Updating .env.local with contract IDs"

  if [ ! -f "$env_file" ]; then
    log_error ".env.local not found at $env_file"
    exit 1
  fi

  log_info "Backing up .env.local to .env.local.bak"
  cp "$env_file" "$env_file.bak"

  # Use regex to replace existing values or add new ones
  if grep -q "NEXT_PUBLIC_SOROBAN_CONTRACT_ID" "$env_file"; then
    sed -i.tmp "s/^NEXT_PUBLIC_SOROBAN_CONTRACT_ID=.*/NEXT_PUBLIC_SOROBAN_CONTRACT_ID=$registry_id/" "$env_file"
  else
    echo "NEXT_PUBLIC_SOROBAN_CONTRACT_ID=$registry_id" >> "$env_file"
  fi

  if grep -q "NEXT_PUBLIC_SOROBAN_VALIDATOR_ID" "$env_file"; then
    sed -i.tmp "s/^NEXT_PUBLIC_SOROBAN_VALIDATOR_ID=.*/NEXT_PUBLIC_SOROBAN_VALIDATOR_ID=$validator_id/" "$env_file"
  else
    echo "NEXT_PUBLIC_SOROBAN_VALIDATOR_ID=$validator_id" >> "$env_file"
  fi

  if [ -n "$af_id" ]; then
    if grep -q "NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID" "$env_file"; then
      sed -i.tmp "s/^NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID=.*/NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID=$af_id/" "$env_file"
    else
      echo "NEXT_PUBLIC_AF_TOKEN_CONTRACT_ID=$af_id" >> "$env_file"
    fi
  fi

  # Clean up temp files
  rm -f "$env_file.tmp"

  log_success ".env.local updated"
  log_info "\n$(grep -E '^NEXT_PUBLIC_SOROBAN.*=' "$env_file" || true)\n"
}

# ─────────────────────────────────────────────────────────────────────────────
# MAIN EXECUTION
# ─────────────────────────────────────────────────────────────────────────────

main() {
  echo -e "${BLUE}"
  echo "╔════════════════════════════════════════════════════════════════════════════╗"
  echo "║        AgentForge Soroban Deployment Script                                ║"
  echo "║                                                                            ║"
  echo "║  Deploying AgentValidator & AgentRegistry to Stellar Testnet              ║"
  echo "╚════════════════════════════════════════════════════════════════════════════╝"
  echo -e "${NC}\n"

  # Verify prerequisites
  check_stellar_cli

  ADMIN_ADDRESS=$(get_deployer_address)
  log_success "Deployer account: $ADMIN_ADDRESS"
  log_info "Network: $STELLAR_NETWORK"
  log_info "RPC: $RPC_URL\n"

  # Build phase
  build_agent_registry
  build_agent_validator
  build_af_token

  # Deployment phase
  REGISTRY_ID=$(deploy_registry | tail -n1)
  VALIDATOR_ID=$(deploy_validator | tail -n1)
  AF_TOKEN_ID=$(deploy_af_token | tail -n1)

  # Initialization phase
  initialize_registry "$REGISTRY_ID" "$ADMIN_ADDRESS" "$VALIDATOR_ID"
  initialize_validator "$VALIDATOR_ID" "$ADMIN_ADDRESS" "$REGISTRY_ID"

  # Update environment
  update_env_local "$REGISTRY_ID" "$VALIDATOR_ID" "$AF_TOKEN_ID"

  # Final summary
  log_step "Deployment Complete! ✨"

  echo -e "${GREEN}"
  echo "📋 Deployment Summary"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "AgentRegistry Contract:"
  echo "  ID: $REGISTRY_ID"
  echo ""
  echo "AgentValidator Contract:"
  echo "  ID: $VALIDATOR_ID"
  echo "  Validation Fee: 5 XLM"
  echo ""
  echo "Environment:"
  echo "  NEXT_PUBLIC_SOROBAN_CONTRACT_ID=$REGISTRY_ID"
  echo "  NEXT_PUBLIC_SOROBAN_VALIDATOR_ID=$VALIDATOR_ID"
  echo ""
  echo "Next Steps:"
  echo "  1. ✓ Contracts deployed and initialized"
  echo "  2. → Test with: pnpm dev (Next.js app will use new contract IDs)"
  echo "  3. → Deploy agent via UI: /agents/build"
  echo "  4. → Sign with Freighter wallet"
  echo "  5. → Agent appears in marketplace after confirmation"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "${NC}"
}

# Run main function
main "$@"
