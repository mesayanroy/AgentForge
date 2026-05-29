use agentforge_server::{app::build_router, config::AppConfig, state::AppState};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = AppConfig::from_env();
    let state = AppState::new(config.clone());
    let listener = tokio::net::TcpListener::bind(config.bind_addr)
        .await
        .expect("failed to bind server address");

    tracing::info!(address = %config.bind_addr, "AgentForge server listening");

    axum::serve(listener, build_router(state))
        .await
        .expect("server failed");
}
