use axum::{routing::{get, post}, Json, Router};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/order", post(place_order))
        .route("/orders", get(list_orders))
        .route("/positions", get(list_positions))
        .route("/pnl", get(get_pnl))
}

fn get_store_path() -> PathBuf {
    if PathBuf::from(".papertrade-store.json").exists() {
        PathBuf::from(".papertrade-store.json")
    } else {
        PathBuf::from("../.papertrade-store.json")
    }
}

fn read_store() -> Value {
    let path = get_store_path();
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(parsed) = serde_json::from_str(&content) {
            return parsed;
        }
    }
    json!({
        "balances": {
            "USDC": 10000.0,
            "XLM": 50000.0
        },
        "trades": []
    })
}

fn write_store(value: &Value) -> Result<(), std::io::Error> {
    let path = get_store_path();
    let content = serde_json::to_string_pretty(value)?;
    fs::write(path, content)
}

async fn place_order(Json(payload): Json<Value>) -> Json<serde_json::Value> {
    let mut store = read_store();
    let mut trades = store["trades"].as_array().cloned().unwrap_or_default();
    
    let action = payload["action"].as_str().unwrap_or("BUY");
    let amount = payload["amount"].as_f64().unwrap_or(0.0);
    let pair = payload["pair"].as_str().unwrap_or("XLM/USDC");
    let price = payload["price"].as_f64().unwrap_or(0.125);
    
    let total_cost = amount * price;
    
    let mut balances = store["balances"].clone();
    let mut usdc = balances["USDC"].as_f64().unwrap_or(10000.0);
    let mut xlm = balances["XLM"].as_f64().unwrap_or(50000.0);
    
    if action == "BUY" {
        if usdc >= total_cost {
            usdc -= total_cost;
            xlm += amount;
        } else {
            return Json(json!({"ok": false, "error": "Insufficient virtual USDC balance"}));
        }
    } else {
        if xlm >= amount {
            xlm -= amount;
            usdc += total_cost;
        } else {
            return Json(json!({"ok": false, "error": "Insufficient virtual XLM balance"}));
        }
    }
    
    balances["USDC"] = json!(usdc);
    balances["XLM"] = json!(xlm);
    store["balances"] = balances;
    
    let timestamp_millis = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
        
    let trade = json!({
        "id": format!("trade-{}", timestamp_millis),
        "timestamp": format!("2026-06-01T01:52:{}Z", timestamp_millis % 60),
        "type": action,
        "pair": pair,
        "size": amount,
        "price": price,
        "pnl_percent": "0.0%"
    });
    
    trades.insert(0, trade);
    store["trades"] = json!(trades);
    
    if let Err(e) = write_store(&store) {
        return Json(json!({"ok": false, "error": format!("Failed to save store: {}", e)}));
    }
    
    Json(json!({"ok": true, "resource": "papertrade", "action": "order", "store": store}))
}

async fn list_orders() -> Json<serde_json::Value> {
    let store = read_store();
    Json(json!({
        "ok": true,
        "resource": "papertrade",
        "action": "orders",
        "items": store["trades"]
    }))
}

async fn list_positions() -> Json<serde_json::Value> {
    let store = read_store();
    let xlm_bal = store["balances"]["XLM"].as_f64().unwrap_or(50000.0);
    let usdc_bal = store["balances"]["USDC"].as_f64().unwrap_or(10000.0);
    Json(json!({
        "ok": true,
        "resource": "papertrade",
        "action": "positions",
        "items": [
            { "asset": "USDC", "balance": usdc_bal, "type": "cash" },
            { "asset": "XLM", "balance": xlm_bal, "type": "position" }
        ]
    }))
}

async fn get_pnl() -> Json<serde_json::Value> {
    let store = read_store();
    let xlm_bal = store["balances"]["XLM"].as_f64().unwrap_or(50000.0);
    let usdc_bal = store["balances"]["USDC"].as_f64().unwrap_or(10000.0);
    let current_value = usdc_bal + xlm_bal * 0.125;
    let initial_value = 16250.0;
    let pnl = current_value - initial_value;
    
    Json(json!({
        "ok": true,
        "resource": "papertrade",
        "action": "pnl",
        "value": pnl
    }))
}
