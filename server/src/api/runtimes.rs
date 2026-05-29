use axum::{extract::Path, routing::{get, post}, Json, Router};
use serde_json::json;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create_runtime).get(list_runtimes))
        .route("/:id", get(get_runtime).delete(delete_runtime))
}

async fn create_runtime() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "runtime", "action": "create"}))
}

async fn list_runtimes() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "runtime", "action": "list", "items": []}))
}

async fn get_runtime(Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "runtime", "action": "get", "id": id}))
}

async fn delete_runtime(Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "runtime", "action": "delete", "id": id}))
}
