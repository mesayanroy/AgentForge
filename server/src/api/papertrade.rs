use axum::{routing::{get, post}, Json, Router};
use serde_json::json;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/order", post(place_order))
        .route("/orders", get(list_orders))
        .route("/positions", get(list_positions))
        .route("/pnl", get(get_pnl))
}

async fn place_order() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "papertrade", "action": "order"}))
}

async fn list_orders() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "papertrade", "action": "orders", "items": []}))
}

async fn list_positions() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "papertrade", "action": "positions", "items": []}))
}

async fn get_pnl() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "papertrade", "action": "pnl", "value": 0}))
}
