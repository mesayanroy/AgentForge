#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone)]
pub struct WalletState {
    pub owner: Address,
    pub spend_limit_stroops: i128,
    pub nonce: u64,
}

#[contracttype]
pub enum DataKey {
    State,
    AllowedContract(Address),
    AllowedDex(Symbol),
}

#[contract]
pub struct AgentWallet;

impl AgentWallet {
    fn require_owner(env: &Env, actor: &Address) {
        let state: WalletState = env.storage().instance().get(&DataKey::State).expect("wallet not initialized");
        assert!(state.owner == actor.clone(), "owner only");
        actor.require_auth();
    }

    fn is_contract_allowed(env: &Env, contract: &Address) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::AllowedContract(contract.clone()))
            .unwrap_or(false)
    }
}

#[contractimpl]
impl AgentWallet {
    pub fn initialize(env: Env, owner: Address, spend_limit_stroops: i128) {
        owner.require_auth();

        assert!(
            env.storage().instance().get::<DataKey, WalletState>(&DataKey::State).is_none(),
            "already initialized"
        );

        env.storage().instance().set(
            &DataKey::State,
            &WalletState {
                owner,
                spend_limit_stroops,
                nonce: 0,
            },
        );
    }

    pub fn set_spend_limit(env: Env, actor: Address, spend_limit_stroops: i128) {
        Self::require_owner(&env, &actor);

        let mut state: WalletState = env.storage().instance().get(&DataKey::State).unwrap();
        state.spend_limit_stroops = spend_limit_stroops;
        state.nonce += 1;
        env.storage().instance().set(&DataKey::State, &state);
    }

    pub fn allow_contract(env: Env, actor: Address, contract: Address) {
        Self::require_owner(&env, &actor);
        env.storage().persistent().set(&DataKey::AllowedContract(contract), &true);
    }

    pub fn revoke_contract(env: Env, actor: Address, contract: Address) {
        Self::require_owner(&env, &actor);
        env.storage().persistent().remove(&DataKey::AllowedContract(contract));
    }

    pub fn allow_dex(env: Env, actor: Address, dex: Symbol) {
        Self::require_owner(&env, &actor);
        env.storage().persistent().set(&DataKey::AllowedDex(dex), &true);
    }

    pub fn revoke_dex(env: Env, actor: Address, dex: Symbol) {
        Self::require_owner(&env, &actor);
        env.storage().persistent().remove(&DataKey::AllowedDex(dex));
    }

    pub fn authorize_spend(
        env: Env,
        actor: Address,
        contract: Address,
        amount_stroops: i128,
    ) -> bool {
        Self::require_owner(&env, &actor);

        let state: WalletState = env.storage().instance().get(&DataKey::State).unwrap();
        assert!(amount_stroops > 0, "amount must be positive");
        assert!(amount_stroops <= state.spend_limit_stroops, "spend limit exceeded");
        assert!(Self::is_contract_allowed(&env, &contract), "contract not allowed");

        true
    }

    pub fn state(env: Env) -> WalletState {
        env.storage().instance().get(&DataKey::State).unwrap()
    }
}
