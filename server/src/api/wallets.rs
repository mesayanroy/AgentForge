use axum::{extract::Path, routing::{get, post}, Json, Router};
use serde_json::json;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create_wallet).get(list_wallets))
        .route("/:id", get(get_wallet))
        .route("/:id/fund", post(fund_wallet))
}

async fn create_wallet() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "wallet", "action": "create"}))
}

async fn list_wallets() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "wallet", "action": "list", "items": []}))
}

async fn get_wallet(Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "wallet", "action": "get", "id": id}))
}

async fn fund_wallet(Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "wallet", "action": "fund", "id": id}))
}
