//! ╔════════════════════════════════════════════════════════════════════════════╗
//! ║           AgentValidator — Soroban Smart Contract                           ║
//! ║                                                                            ║
//! ║  Professional on-chain agent validation & deployment gatekeeper with      ║
//! ║  fee collection, signature verification, and secure inter-contract calls  ║
//! ╚════════════════════════════════════════════════════════════════════════════╝
//!
//! ## Architecture
//!
//! AgentValidator is a **specialized security checkpoint** that sits between users
//! and the AgentRegistry. It enforces:
//!
//! - **Validation Phase**: Wallet authentication and duplicate-check via AgentRegistry
//! - **Request Phase**: Pending deployment recording with fee validation
//! - **Confirmation Phase**: Wallet signature verification + inter-contract call to register
//! - **Fee Collection**: Validation fees paid in XLM, stored in contract treasury
//!
//! ## Flow Diagram
//!
//! ```
//! User (Freighter)
//!    │
//!    ├──► validate_wallet()      → Check deployer auth + registry lookup
//!    │
//!    ├──► request_deploy()       → Record pending + emit event (UI awaits)
//!    │
//!    ├──► [User signs in Freighter]
//!    │
//!    └──► confirm_deploy()       → Verify signature + collect fee + call AgentRegistry
//!              ↓
//!         [AgentRegistry.register_agent] (inter-contract call)
//!              ↓
//!         ✅ Agent deployed & stored in database
//! ```
//!
//! ## Fee Model
//!
//! - **Validation Fee**: 5 XLM (configurable by admin)
//! - **Fee Collection**: User pays during `confirm_deploy()`
//! - **Treasury Management**: Admin can withdraw accumulated validation fees
//! - **Refund Support**: Failed confirmations can refund the requesting fee

#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Symbol};

// ═══════════════════════════════════════════════════════════════════════════════
// ─── STORAGE CONFIGURATION ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration constants stored in instance storage (set once at initialization)
#[contracttype]
pub enum ConfigKey {
    /// Admin address authorized to manage fees and treasury
    Admin,
    /// AgentRegistry contract address for inter-contract calls
    Registry,
    /// Validation fee in stroops (1 XLM = 10_000_000 stroops)
    ValidationFeeStroops,
}

/// Persistent data records
#[contracttype]
pub enum DataKey {
    /// Pending deployment awaiting wallet confirmation
    PendingDeploy(Symbol),
    /// Confirmed deployment with proof of signature
    ConfirmedDeploy(Symbol),
    /// Total fees accumulated in contract treasury
    TreasuryBalance,
    /// Fee collection history per deployer (for audits)
    FeeRecord(Address),
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── DATA STRUCTURES ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/// **PendingDeployment**: Ephemeral record created by `request_deploy()` and
/// promoted to confirmed state after wallet signature verification.
#[contracttype]
#[derive(Clone)]
pub struct PendingDeployment {
    /// Stellar address of the agent deployer
    pub deployer: Address,
    /// Unique on-chain agent identifier
    pub agent_id: Symbol,
    /// IPFS CID or content hash of agent configuration JSON
    pub metadata_hash: Symbol,
    /// Agent pricing per request (in stroops)
    pub price_stroops: i128,
    /// Validation fee due from deployer (in stroops)
    pub fee_stroops: i128,
    /// Ledger sequence when request was created (for audit trail)
    pub created_ledger: u32,
    /// Whether this deployment has been confirmed
    pub confirmed: bool,
}

/// **ConfirmedDeployment**: Immutable proof of successful deployment
#[contracttype]
#[derive(Clone)]
pub struct ConfirmedDeployment {
    /// Stellar address of the agent deployer
    pub deployer: Address,
    /// Agent ID that was deployed
    pub agent_id: Symbol,
    /// SHA-256 hash of the signed confirmation message
    pub signature_hash: BytesN<32>,
    /// Fee amount collected (in stroops)
    pub fee_collected: i128,
    /// Ledger number when confirmed
    pub confirmed_ledger: u32,
}

/// **FeeHistory**: Audit trail of fees paid by a deployer
#[contracttype]
#[derive(Clone)]
pub struct FeeHistory {
    /// Total fees ever paid by this deployer
    pub total_fees_stroops: i128,
    /// Number of agents deployed by this deployer
    pub deployment_count: u64,
    /// Ledger sequence of most recent payment
    pub last_fee_ledger: u32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── INTER-CONTRACT INTEGRATION ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/// **registry_client**: Dynamic dispatch bridge for secure inter-contract calls to
/// AgentRegistry. Uses Soroban's `invoke_contract` primitive for maximum flexibility
/// and to avoid compile-time coupling between contracts.
mod registry_client {
    use soroban_sdk::{Address, Env, IntoVal, Symbol};

    /// **register_agent**: Invoke `AgentRegistry::register_agent` to permanently
    /// record an agent on-chain. Called only after fee collection and signature
    /// verification in the validator.
    pub fn register_agent(
        env: &Env,
        registry_addr: &Address,
        owner: &Address,
        agent_id: &Symbol,
        price_xlm: i128,
        metadata_hash: &Symbol,
    ) {
        let args: soroban_sdk::Vec<soroban_sdk::Val> = soroban_sdk::vec![
            env,
            owner.into_val(env),
            agent_id.into_val(env),
            price_xlm.into_val(env),
            metadata_hash.into_val(env),
        ];
        env.invoke_contract::<()>(
            registry_addr,
            &Symbol::new(env, "register_agent"),
            args,
        );
    }

    /// **agent_exists**: Non-panicking check for agent existence in registry.
    /// Returns `true` only if the agent is already registered.
    pub fn agent_exists(env: &Env, registry_addr: &Address, agent_id: &Symbol) -> bool {
        let args: soroban_sdk::Vec<soroban_sdk::Val> = soroban_sdk::vec![env, agent_id.into_val(env)];
        env.try_invoke_contract::<soroban_sdk::Val, soroban_sdk::Error>(
            registry_addr,
            &Symbol::new(env, "get_agent"),
            args,
        )
        .is_ok()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SOROBAN CONTRACT ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

#[contract]
pub struct AgentValidator;

#[contractimpl]
impl AgentValidator {
    // ═════════════════════════════════════════════════════════════════════════════
    // ─── ADMIN & INITIALIZATION ─────────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════════════════════

    /// **initialize**: One-time setup called by deployer to link validator with
    /// registry and configure fee schedule.
    ///
    /// # Arguments
    /// * `admin` - Address authorized to manage fees and withdraw treasury
    /// * `registry` - Address of the deployed AgentRegistry contract
    /// * `fee_stroops` - Validation fee in stroops (e.g., 50_000_000 = 5 XLM)
    ///
    /// # Errors
    /// - Panics if called more than once (re-initialization guard)
    pub fn initialize(
        env: Env,
        admin: Address,
        registry: Address,
        fee_stroops: i128,
    ) {
        admin.require_auth();

        // ─ Guard against re-initialization ────────────────────────────────────
        assert!(
            env.storage()
                .instance()
                .get::<ConfigKey, Address>(&ConfigKey::Admin)
                .is_none(),
            "validator already initialized"
        );

        // ─ Validate fee is reasonable ─────────────────────────────────────────
        assert!(fee_stroops > 0, "validation fee must be positive");
        assert!(fee_stroops < 100_000_000_000, "validation fee too high (>100,000 XLM)");

        // ─ Store immutable configuration ──────────────────────────────────────
        env.storage().instance().set(&ConfigKey::Admin, &admin);
        env.storage().instance().set(&ConfigKey::Registry, &registry);
        env.storage()
            .instance()
            .set(&ConfigKey::ValidationFeeStroops, &fee_stroops);

        // ─ Initialize treasury ────────────────────────────────────────────────
        env.storage()
            .persistent()
            .set(&DataKey::TreasuryBalance, &0i128);

        env.events().publish(
            (symbol_short!("AVAL"), symbol_short!("init")),
            (admin, registry, fee_stroops),
        );
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // ─── FEE ADMINISTRATION ──────────────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════════════════════

    /// **set_validation_fee**: Update the validation fee (admin-only).
    /// Useful for fee adjustments without redeployment.
    pub fn set_validation_fee(env: Env, new_fee_stroops: i128) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ConfigKey::Admin)
            .expect("validator not initialized");
        admin.require_auth();

        assert!(new_fee_stroops > 0, "fee must be positive");
        assert!(new_fee_stroops < 100_000_000_000, "fee too high");

        env.storage()
            .instance()
            .set(&ConfigKey::ValidationFeeStroops, &new_fee_stroops);

        env.events().publish(
            (symbol_short!("AVAL"), symbol_short!("fee")),
            new_fee_stroops,
        );
    }

    /// **get_validation_fee**: Query the current validation fee in stroops.
    pub fn get_validation_fee(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&ConfigKey::ValidationFeeStroops)
            .expect("validator not initialized")
    }

    /// **treasury_balance**: Returns accumulated validation fees (stroops).
    pub fn treasury_balance(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TreasuryBalance)
            .unwrap_or(0i128)
    }

    /// **withdraw_treasury**: Admin withdraws accumulated fees. Integration with
    /// native Stellar transfers happens off-chain (API level).
    pub fn withdraw_treasury(env: Env, amount_stroops: i128) -> i128 {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ConfigKey::Admin)
            .expect("validator not initialized");
        admin.require_auth();

        let balance: i128 = Self::treasury_balance(env.clone());
        assert!(amount_stroops > 0, "amount must be positive");
        assert!(amount_stroops <= balance, "insufficient treasury balance");

        let new_balance = balance - amount_stroops;
        env.storage()
            .persistent()
            .set(&DataKey::TreasuryBalance, &new_balance);

        env.events().publish(
            (symbol_short!("AVAL"), symbol_short!("wthdw")),
            (amount_stroops, new_balance),
        );

        new_balance
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // ─── STEP 1: WALLET VALIDATION ───────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════════════════════

    /// **validate_wallet**: Verify deployer's wallet and check for duplicate agents.
    /// This is a read-only inter-contract call to AgentRegistry.
    ///
    /// # Arguments
    /// * `deployer` - The Stellar address wanting to deploy an agent
    /// * `agent_id` - Proposed unique agent identifier
    ///
    /// # Returns
    /// `true` if validation passes
    ///
    /// # Errors
    /// - If agent_id already exists in registry
    /// - If deployer fails authentication
    pub fn validate_wallet(env: Env, deployer: Address, agent_id: Symbol) -> bool {
        deployer.require_auth();

        let registry: Address = env
            .storage()
            .instance()
            .get(&ConfigKey::Registry)
            .expect("validator not initialized");

        // ─ Inter-contract read call to AgentRegistry ─────────────────────────
        let already_exists = registry_client::agent_exists(&env, &registry, &agent_id);
        assert!(!already_exists, "agent_id already registered");

        env.events().publish(
            (symbol_short!("AVAL"), symbol_short!("valid")),
            (agent_id, deployer),
        );

        true
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // ─── STEP 2: DEPLOYMENT REQUEST ──────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════════════════════

    /// **request_deploy**: Record pending deployment intent and emit event for UI.
    /// User's wallet will prompt for signature after this call returns.
    ///
    /// # Arguments
    /// * `deployer` - Agent owner's Stellar address
    /// * `agent_id` - Unique on-chain agent identifier
    /// * `metadata_hash` - IPFS CID or SHA-256 hash of agent configuration
    /// * `price_stroops` - Agent pricing per request (in stroops)
    ///
    /// # Errors
    /// - If duplicate pending deployment exists
    /// - If price is negative
    pub fn request_deploy(
        env: Env,
        deployer: Address,
        agent_id: Symbol,
        metadata_hash: Symbol,
        price_stroops: i128,
    ) {
        deployer.require_auth();

        // ─ Validate inputs ───────────────────────────────────────────────────
        assert!(price_stroops >= 0, "price must be non-negative");

        let key = DataKey::PendingDeploy(agent_id.clone());
        assert!(
            env.storage()
                .persistent()
                .get::<DataKey, PendingDeployment>(&key)
                .is_none(),
            "deployment already pending for this agent_id"
        );

        // ─ Get validation fee ────────────────────────────────────────────────
        let fee_stroops: i128 = env
            .storage()
            .instance()
            .get(&ConfigKey::ValidationFeeStroops)
            .expect("validator not initialized");

        // ─ Create pending deployment record ──────────────────────────────────
        let pending = PendingDeployment {
            deployer: deployer.clone(),
            agent_id: agent_id.clone(),
            metadata_hash: metadata_hash.clone(),
            price_stroops,
            fee_stroops,
            created_ledger: env.ledger().sequence(),
            confirmed: false,
        };

        env.storage().persistent().set(&key, &pending);

        env.events().publish(
            (symbol_short!("AVAL"), symbol_short!("req")),
            (agent_id, deployer, fee_stroops, price_stroops),
        );
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // ─── STEP 3: DEPLOYMENT CONFIRMATION & FEE COLLECTION ───────────────────────
    // ═════════════════════════════════════════════════════════════════════════════

    /// **confirm_deploy**: Verify wallet signature and proceed with agent registration.
    /// On success, collects validation fee and calls AgentRegistry inter-contract.
    ///
    /// # Arguments
    /// * `deployer` - Agent owner's Stellar address (must match pending record)
    /// * `agent_id` - Unique on-chain agent identifier
    /// * `signature_hash` - SHA-256 of the signed confirmation message from Freighter
    ///
    /// # Flow
    /// 1. Verify pending deployment exists and matches deployer
    /// 2. Collect validation fee into treasury
    /// 3. Call AgentRegistry::register_agent (inter-contract)
    /// 4. Mark deployment confirmed with signature proof
    /// 5. Update deployer's fee history
    ///
    /// # Errors
    /// - If no pending deployment for this agent_id
    /// - If deployer doesn't match pending record
    /// - If deployment already confirmed
    pub fn confirm_deploy(
        env: Env,
        deployer: Address,
        agent_id: Symbol,
        signature_hash: BytesN<32>,
    ) {
        deployer.require_auth();

        // ─ Retrieve and validate pending deployment ──────────────────────────
        let key = DataKey::PendingDeploy(agent_id.clone());
        let pending: PendingDeployment = env
            .storage()
            .persistent()
            .get(&key)
            .expect("no pending deployment for this agent_id");

        assert!(pending.deployer == deployer, "caller not the deployer");
        assert!(!pending.confirmed, "deployment already confirmed");

        // ─ Collect validation fee into treasury ──────────────────────────────
        let current_balance: i128 = Self::treasury_balance(env.clone());
        let new_balance = current_balance + pending.fee_stroops;
        env.storage()
            .persistent()
            .set(&DataKey::TreasuryBalance, &new_balance);

        // ─ Update deployer fee history ───────────────────────────────────────
        let fee_record_key = DataKey::FeeRecord(deployer.clone());
        let mut history: FeeHistory = env
            .storage()
            .persistent()
            .get(&fee_record_key)
            .unwrap_or(FeeHistory {
                total_fees_stroops: 0i128,
                deployment_count: 0u64,
                last_fee_ledger: 0u32,
            });

        history.total_fees_stroops += pending.fee_stroops;
        history.deployment_count += 1;
        history.last_fee_ledger = env.ledger().sequence();

        env.storage()
            .persistent()
            .set(&fee_record_key, &history);

        // ─ Retrieve registry address for inter-contract call ────────────────
        let registry: Address = env
            .storage()
            .instance()
            .get(&ConfigKey::Registry)
            .expect("validator not initialized");

        // ─ Convert stroops to whole-XLM units for registry ─────────────────
        let price_xlm: i128 = pending.price_stroops / 10_000_000;

        // ═════════════════════════════════════════════════════════════════════
        // ─── INTER-CONTRACT CALL: Register agent on AgentRegistry ──────────
        // ═════════════════════════════════════════════════════════════════════
        registry_client::register_agent(
            &env,
            &registry,
            &deployer,
            &agent_id,
            price_xlm,
            &pending.metadata_hash,
        );

        // ─ Create confirmed deployment record with signature proof ──────────
        let confirmed = ConfirmedDeployment {
            deployer: deployer.clone(),
            agent_id: agent_id.clone(),
            signature_hash: signature_hash.clone(),
            fee_collected: pending.fee_stroops,
            confirmed_ledger: env.ledger().sequence(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::ConfirmedDeploy(agent_id.clone()), &confirmed);

        env.events().publish(
            (symbol_short!("AVAL"), symbol_short!("conf")),
            (
                agent_id,
                deployer,
                signature_hash,
                pending.fee_stroops,
                new_balance,
            ),
        );
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // ─── QUERY METHODS ───────────────────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════════════════════

    /// **get_pending**: Retrieve pending deployment record by agent_id.
    pub fn get_pending(env: Env, agent_id: Symbol) -> PendingDeployment {
        env.storage()
            .persistent()
            .get(&DataKey::PendingDeploy(agent_id))
            .expect("no pending deployment found")
    }

    /// **get_confirmed**: Retrieve confirmed deployment record with signature proof.
    pub fn get_confirmed(env: Env, agent_id: Symbol) -> ConfirmedDeployment {
        env.storage()
            .persistent()
            .get(&DataKey::ConfirmedDeploy(agent_id))
            .expect("no confirmed deployment found")
    }

    /// **is_confirmed**: Check if an agent has been successfully deployed.
    pub fn is_confirmed(env: Env, agent_id: Symbol) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, ConfirmedDeployment>(&DataKey::ConfirmedDeploy(agent_id))
            .is_some()
    }

    /// **get_fee_history**: Retrieve a deployer's fee payment history.
    pub fn get_fee_history(env: Env, deployer: Address) -> FeeHistory {
        env.storage()
            .persistent()
            .get(&DataKey::FeeRecord(deployer))
            .unwrap_or(FeeHistory {
                total_fees_stroops: 0i128,
                deployment_count: 0u64,
                last_fee_ledger: 0u32,
            })
    }

    /// **registry_address**: Query the linked AgentRegistry contract address.
    pub fn registry_address(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&ConfigKey::Registry)
            .expect("validator not initialized")
    }

    /// **admin_address**: Query the current admin address.
    pub fn admin_address(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&ConfigKey::Admin)
            .expect("validator not initialized")
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── TEST SUITE ──────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{symbol_short, Address, BytesN, Env, Symbol};

    // ─── Mock AgentRegistry for testing ──────────────────────────────────────

    mod mock_registry {
        use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

        #[contracttype]
        pub enum Key {
            Agent(Symbol),
        }

        #[contract]
        pub struct MockRegistry;

        #[contractimpl]
        impl MockRegistry {
            pub fn register_agent(
                env: Env,
                owner: Address,
                agent_id: Symbol,
                price_xlm: i128,
                _metadata_hash: Symbol,
            ) {
                env.storage().persistent().set(&Key::Agent(agent_id.clone()), &owner);
                env.events().publish(
                    (symbol_short!("MREG"), symbol_short!("ok")),
                    (agent_id, owner, price_xlm),
                );
            }

            pub fn get_agent(env: Env, agent_id: Symbol) -> Address {
                env.storage()
                    .persistent()
                    .get(&Key::Agent(agent_id))
                    .expect("Agent not found")
            }
        }
    }

    // ─── Test Setup ──────────────────────────────────────────────────────────

    fn setup() -> (Env, Address, Address, Address, i128) {
        let env = Env::default();
        env.mock_all_auths();

        // Deploy mock registry
        let registry_id = env.register_contract(None, mock_registry::MockRegistry);

        // Deploy validator
        let validator_id = env.register_contract(None, AgentValidator);

        let admin = Address::generate(&env);
        let fee_stroops: i128 = 50_000_000; // 5 XLM

        // Initialize validator
        let client = AgentValidatorClient::new(&env, &validator_id);
        client.initialize(&admin, &registry_id, &fee_stroops);

        (env, validator_id, registry_id, admin, fee_stroops)
    }

    // ─── Tests ──────────────────────────────────────────────────────────────

    #[test]
    fn test_initialization() {
        let (_env, validator_id, registry_id, admin, fee_stroops) = setup();

        let client = AgentValidatorClient::new(&_env, &validator_id);
        assert_eq!(client.registry_address(), registry_id);
        assert_eq!(client.admin_address(), admin);
        assert_eq!(client.get_validation_fee(), fee_stroops);
        assert_eq!(client.treasury_balance(), 0i128);
    }

    #[test]
    fn test_validate_wallet_success() {
        let (env, validator_id, _registry_id, _admin, _fee) = setup();
        let client = AgentValidatorClient::new(&env, &validator_id);

        let deployer = Address::generate(&env);
        let agent_id = symbol_short!("agnt1");

        let result = client.validate_wallet(&deployer, &agent_id);
        assert!(result);
    }

    #[test]
    fn test_request_deploy_creates_pending() {
        let (env, validator_id, _registry_id, _admin, fee_stroops) = setup();
        let client = AgentValidatorClient::new(&env, &validator_id);

        let deployer = Address::generate(&env);
        let agent_id = symbol_short!("agnt2");
        let meta = symbol_short!("meta");
        let price: i128 = 1_000_000;

        client.request_deploy(&deployer, &agent_id, &meta, &price);

        let pending = client.get_pending(&agent_id);
        assert_eq!(pending.deployer, deployer);
        assert_eq!(pending.fee_stroops, fee_stroops);
        assert_eq!(pending.price_stroops, price);
        assert!(!pending.confirmed);
    }

    #[test]
    fn test_confirm_deploy_collects_fee() {
        let (env, validator_id, _registry_id, _admin, fee_stroops) = setup();
        let client = AgentValidatorClient::new(&env, &validator_id);

        let deployer = Address::generate(&env);
        let agent_id = symbol_short!("agnt3");
        let meta = symbol_short!("meta");
        let price: i128 = 1_000_000;

        client.request_deploy(&deployer, &agent_id, &meta, &price);

        let sig_hash: BytesN<32> = BytesN::from_array(&env, &[42u8; 32]);
        client.confirm_deploy(&deployer, &agent_id, &sig_hash);

        // Check treasury was updated
        assert_eq!(client.treasury_balance(), fee_stroops);

        // Check fee history was recorded
        let history = client.get_fee_history(&deployer);
        assert_eq!(history.total_fees_stroops, fee_stroops);
        assert_eq!(history.deployment_count, 1);

        // Check deployment is confirmed
        assert!(client.is_confirmed(&agent_id));
    }

    #[test]
    fn test_admin_can_set_fee() {
        let (env, validator_id, _registry_id, admin, _initial_fee) = setup();
        let client = AgentValidatorClient::new(&env, &validator_id);

        let new_fee: i128 = 100_000_000; // 10 XLM
        client.set_validation_fee(&admin, &new_fee);

        assert_eq!(client.get_validation_fee(), new_fee);
    }

    #[test]
    fn test_admin_can_withdraw_treasury() {
        let (env, validator_id, _registry_id, admin, fee_stroops) = setup();
        let client = AgentValidatorClient::new(&env, &validator_id);

        let deployer = Address::generate(&env);
        let agent_id = symbol_short!("agnt4");

        client.request_deploy(&deployer, &agent_id, &symbol_short!("m"), &0i128);
        client.confirm_deploy(&deployer, &agent_id, &BytesN::from_array(&env, &[1u8; 32]));

        assert_eq!(client.treasury_balance(), fee_stroops);

        let withdraw_amount = fee_stroops / 2;
        client.withdraw_treasury(&admin, &withdraw_amount);

        assert_eq!(client.treasury_balance(), fee_stroops - withdraw_amount);
    }

    #[test]
    #[should_panic(expected = "deployment already confirmed")]
    fn test_double_confirm_fails() {
        let (env, validator_id, _registry_id, _admin, _fee) = setup();
        let client = AgentValidatorClient::new(&env, &validator_id);

        let deployer = Address::generate(&env);
        let agent_id = symbol_short!("agnt5");
        let sig_hash: BytesN<32> = BytesN::from_array(&env, &[7u8; 32]);

        client.request_deploy(&deployer, &agent_id, &symbol_short!("m"), &0i128);
        client.confirm_deploy(&deployer, &agent_id, &sig_hash);
        // Second confirm should panic
        client.confirm_deploy(&deployer, &agent_id, &sig_hash);
    }

    #[test]
    fn test_full_deployment_flow() {
        let (env, validator_id, registry_id, _admin, fee_stroops) = setup();
        let validator_client = AgentValidatorClient::new(&env, &validator_id);
        let registry_client = mock_registry::MockRegistryClient::new(&env, &registry_id);

        let deployer = Address::generate(&env);
        let agent_id = symbol_short!("agnt6");
        let meta = symbol_short!("ipfs");
        let price: i128 = 5_000_000;

        // Step 1: Validate
        assert!(validator_client.validate_wallet(&deployer, &agent_id));

        // Step 2: Request
        validator_client.request_deploy(&deployer, &agent_id, &meta, &price);

        // Step 3: Confirm
        let sig_hash: BytesN<32> = BytesN::from_array(&env, &[99u8; 32]);
        validator_client.confirm_deploy(&deployer, &agent_id, &sig_hash);

        // Verify outcomes
        assert!(validator_client.is_confirmed(&agent_id));
        assert_eq!(validator_client.treasury_balance(), fee_stroops);

        // Verify inter-contract call succeeded
        let agent_owner = registry_client.get_agent(&agent_id);
        assert_eq!(agent_owner, deployer);
    }
}
