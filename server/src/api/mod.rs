use axum::Router;

use crate::state::AppState;

pub mod agents;
pub mod audits;
pub mod papertrade;
pub mod runtimes;
pub mod wallets;
pub mod workflows;

pub fn router() -> Router<AppState> {
    Router::new()
        .nest("/agents", agents::router())
        .nest("/workflows", workflows::router())
        .nest("/runtimes", runtimes::router())
        .nest("/wallets", wallets::router())
        .nest("/papertrade", papertrade::router())
        .nest("/audits", audits::router())
}
