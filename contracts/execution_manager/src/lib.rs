#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum ExecutionStatus {
    Pending,
    Queued,
    Running,
    Failed,
    Completed,
}

#[contracttype]
#[derive(Clone)]
pub struct RuntimeReference {
    pub runtime_id: Symbol,
    pub image: Symbol,
    pub sandbox_root: Symbol,
    pub logs_root: Symbol,
    pub artifacts_root: Symbol,
}

#[contracttype]
#[derive(Clone)]
pub struct ExecutionRecord {
    pub execution_id: Symbol,
    pub workflow_id: Symbol,
    pub agent_id: Symbol,
    pub requester: Address,
    pub status: ExecutionStatus,
    pub runtime: Option<RuntimeReference>,
    pub proof_hash: Option<Symbol>,
    pub error: Option<Symbol>,
    pub retries: u32,
    pub created_ledger: u32,
    pub updated_ledger: u32,
}

#[contracttype]
pub enum DataKey {
    Admin,
    RuntimeRouter,
    Execution(Symbol),
}

#[contract]
pub struct ExecutionManager;

impl ExecutionManager {
    fn require_admin(env: &Env, actor: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("execution manager not initialized");
        assert!(admin == actor.clone(), "admin only");
        actor.require_auth();
    }

    fn load_execution(env: &Env, execution_id: &Symbol) -> ExecutionRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Execution(execution_id.clone()))
            .expect("execution not found")
    }

    fn persist_execution(env: &Env, record: &ExecutionRecord) {
        env.storage()
            .persistent()
            .set(&DataKey::Execution(record.execution_id.clone()), record);
    }
}

#[contractimpl]
impl ExecutionManager {
    pub fn initialize(env: Env, admin: Address, runtime_router: Address) {
        admin.require_auth();

        assert!(
            env.storage().instance().get::<DataKey, Address>(&DataKey::Admin).is_none(),
            "already initialized"
        );

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::RuntimeRouter, &runtime_router);
    }

    pub fn submit_execution(
        env: Env,
        requester: Address,
        execution_id: Symbol,
        workflow_id: Symbol,
        agent_id: Symbol,
    ) {
        requester.require_auth();

        let key = DataKey::Execution(execution_id.clone());
        assert!(
            env.storage().persistent().get::<DataKey, ExecutionRecord>(&key).is_none(),
            "execution already exists"
        );

        let record = ExecutionRecord {
            execution_id,
            workflow_id,
            agent_id,
            requester,
            status: ExecutionStatus::Pending,
            runtime: None,
            proof_hash: None,
            error: None,
            retries: 0,
            created_ledger: env.ledger().sequence(),
            updated_ledger: env.ledger().sequence(),
        };

        env.storage().persistent().set(&key, &record);
    }

    pub fn queue_execution(env: Env, actor: Address, execution_id: Symbol) {
        Self::require_admin(&env, &actor);

        let mut record = Self::load_execution(&env, &execution_id);
        record.status = ExecutionStatus::Queued;
        record.updated_ledger = env.ledger().sequence();
        Self::persist_execution(&env, &record);
    }

    pub fn start_execution(
        env: Env,
        actor: Address,
        execution_id: Symbol,
        runtime_id: Symbol,
        image: Symbol,
        sandbox_root: Symbol,
        logs_root: Symbol,
        artifacts_root: Symbol,
    ) {
        Self::require_admin(&env, &actor);

        let mut record = Self::load_execution(&env, &execution_id);
        record.status = ExecutionStatus::Running;
        record.runtime = Some(RuntimeReference {
            runtime_id,
            image,
            sandbox_root,
            logs_root,
            artifacts_root,
        });
        record.updated_ledger = env.ledger().sequence();
        Self::persist_execution(&env, &record);
    }

    pub fn complete_execution(
        env: Env,
        actor: Address,
        execution_id: Symbol,
        proof_hash: Symbol,
    ) {
        Self::require_admin(&env, &actor);

        let mut record = Self::load_execution(&env, &execution_id);
        record.status = ExecutionStatus::Completed;
        record.proof_hash = Some(proof_hash);
        record.error = None;
        record.updated_ledger = env.ledger().sequence();
        Self::persist_execution(&env, &record);
    }

    pub fn fail_execution(env: Env, actor: Address, execution_id: Symbol, error: Symbol) {
        Self::require_admin(&env, &actor);

        let mut record = Self::load_execution(&env, &execution_id);
        record.status = ExecutionStatus::Failed;
        record.error = Some(error);
        record.retries += 1;
        record.updated_ledger = env.ledger().sequence();
        Self::persist_execution(&env, &record);
    }

    pub fn get_execution(env: Env, execution_id: Symbol) -> Option<ExecutionRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Execution(execution_id))
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }
}

#[cfg(test)]
mod test {}
