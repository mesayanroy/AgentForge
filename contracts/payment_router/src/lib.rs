#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone)]
pub struct FeeSchedule {
    pub protocol_fee_bps: u32,
    pub execution_fee_bps: u32,
    pub workflow_fee_bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct PaymentRecord {
    pub payer: Address,
    pub invoice_id: Symbol,
    pub purpose: Symbol,
    pub amount_stroops: i128,
    pub settled_ledger: u32,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Treasury,
    FeeSchedule,
    Payment(Symbol),
}

#[contract]
pub struct PaymentRouter;

impl PaymentRouter {
    fn require_admin(env: &Env, actor: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("payment router not initialized");
        assert!(admin == actor.clone(), "admin only");
        actor.require_auth();
    }

    fn current_treasury_balance(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Treasury)
            .unwrap_or(0)
    }
}

#[contractimpl]
impl PaymentRouter {
    pub fn initialize(env: Env, admin: Address, protocol_fee_bps: u32, execution_fee_bps: u32, workflow_fee_bps: u32) {
        admin.require_auth();

        assert!(
            env.storage().instance().get::<DataKey, Address>(&DataKey::Admin).is_none(),
            "already initialized"
        );

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &0i128);
        env.storage().instance().set(
            &DataKey::FeeSchedule,
            &FeeSchedule {
                protocol_fee_bps,
                execution_fee_bps,
                workflow_fee_bps,
            },
        );
    }

    pub fn set_fee_schedule(
        env: Env,
        actor: Address,
        protocol_fee_bps: u32,
        execution_fee_bps: u32,
        workflow_fee_bps: u32,
    ) {
        Self::require_admin(&env, &actor);
        env.storage().instance().set(
            &DataKey::FeeSchedule,
            &FeeSchedule {
                protocol_fee_bps,
                execution_fee_bps,
                workflow_fee_bps,
            },
        );
    }

    pub fn settle_402(
        env: Env,
        payer: Address,
        invoice_id: Symbol,
        purpose: Symbol,
        amount_stroops: i128,
    ) {
        payer.require_auth();
        assert!(amount_stroops > 0, "amount must be positive");

        let key = DataKey::Payment(invoice_id.clone());
        assert!(
            env.storage().persistent().get::<DataKey, PaymentRecord>(&key).is_none(),
            "payment already settled"
        );

        let record = PaymentRecord {
            payer,
            invoice_id,
            purpose,
            amount_stroops,
            settled_ledger: env.ledger().sequence(),
        };

        let treasury = Self::current_treasury_balance(&env);
        env.storage()
            .instance()
            .set(&DataKey::Treasury, &(treasury + amount_stroops));
        env.storage().persistent().set(&key, &record);
    }

    pub fn get_fee_schedule(env: Env) -> FeeSchedule {
        env.storage().instance().get(&DataKey::FeeSchedule).unwrap()
    }

    pub fn treasury_balance(env: Env) -> i128 {
        Self::current_treasury_balance(&env)
    }
}
