use axum::{extract::Path, routing::{get, post}, Json, Router};
use serde_json::json;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create_agent).get(list_agents))
        .route("/:id", get(get_agent).delete(delete_agent))
}

async fn create_agent() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "agent", "action": "create"}))
}

async fn list_agents() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "agent", "action": "list", "items": []}))
}

async fn get_agent(Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "agent", "action": "get", "id": id}))
}

async fn delete_agent(Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "agent", "action": "delete", "id": id}))
}
