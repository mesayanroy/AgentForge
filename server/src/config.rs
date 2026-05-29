use std::{env, net::SocketAddr};

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub bind_addr: SocketAddr,
    pub database_url: Option<String>,
    pub redis_url: Option<String>,
    pub nats_url: Option<String>,
    pub minio_url: Option<String>,
    pub ipfs_url: Option<String>,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let bind_addr = env::var("AGENTFORGE_BIND_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:8080".to_string())
            .parse()
            .expect("AGENTFORGE_BIND_ADDR must be a valid socket address");

        Self {
            bind_addr,
            database_url: env::var("DATABASE_URL").ok(),
            redis_url: env::var("REDIS_URL").ok(),
            nats_url: env::var("NATS_URL").ok(),
            minio_url: env::var("MINIO_URL").ok(),
            ipfs_url: env::var("IPFS_URL").ok(),
        }
    }
}
