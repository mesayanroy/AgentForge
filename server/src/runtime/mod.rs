use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum RuntimeLifecycle {
    Created,
    Booting,
    Running,
    Waiting,
    Failed,
    Completed,
    Destroyed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RuntimeDescriptor {
    pub id: String,
    pub image: String,
    pub lifecycle: RuntimeLifecycle,
}

#[derive(Clone, Debug, Default)]
pub struct RuntimeManager;

impl RuntimeManager {
    pub fn new() -> Self {
        Self
    }
}
