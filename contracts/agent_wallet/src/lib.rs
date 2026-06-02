#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, IntoVal};

#[contract]
pub struct AgentWallet;

#[contractimpl]
impl AgentWallet {
    pub fn initialize(env: Env, owner: Address) {
        owner.require_auth();
        let key = Symbol::new(&env, "owner");
        if env.storage().instance().has(&key) {
            panic!();
        }
        env.storage().instance().set(&key, &owner);
    }

    pub fn withdraw(
        env: Env,
        actor: Address,
        token: Address,
        to: Address,
        amount_stroops: i128,
    ) {
        let key = Symbol::new(&env, "owner");
        let owner: Address = env.storage().instance().get(&key).unwrap();
        if owner != actor {
            panic!();
        }
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
        let key = Symbol::new(&env, "owner");
        env.storage().instance().get(&key).unwrap()
    }
}
