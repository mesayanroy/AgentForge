#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, IntoVal};

#[contract]
pub struct AgentWallet;

#[contractimpl]
impl AgentWallet {
    pub fn initialize(env: Env, owner: Address, _spend_limit_stroops: i128) {
        owner.require_auth();
        assert!(
            !env.storage().instance().has(&Symbol::new(&env, "owner")),
            "already initialized"
        );
        env.storage().instance().set(&Symbol::new(&env, "owner"), &owner);
    }

    pub fn withdraw(
        env: Env,
        actor: Address,
        token: Address,
        to: Address,
        amount_stroops: i128,
    ) {
        let owner: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "owner"))
            .expect("wallet not initialized");
        
        assert!(owner == actor, "owner only");
        actor.require_auth();
        
        let args: soroban_sdk::Vec<soroban_sdk::Val> = soroban_sdk::vec![
            &env,
            env.current_contract_address().into_val(&env),
            to.into_val(&env),
            amount_stroops.into_val(&env),
        ];
        
        env.invoke_contract::<()>(
            &token,
            &Symbol::new(&env, "transfer"),
            args,
        );
    }

    pub fn owner(env: Env) -> Address {
        env.storage().instance().get(&Symbol::new(&env, "owner")).unwrap()
    }
}
