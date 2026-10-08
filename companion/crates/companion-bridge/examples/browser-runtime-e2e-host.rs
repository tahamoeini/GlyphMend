//! Test-only loopback host for the browser-to-Companion protocol E2E suite.
//! Uses the diagnostic provider exposed by JobManager::default and is not part
//! of any shipped Companion package.

use companion_bridge::{start, BridgeConfig};
use companion_service::JobManager;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments = std::env::args().collect::<Vec<_>>();
    let web_origin = parse_web_origin(&arguments)?;
    let config = BridgeConfig::for_web_origin(&web_origin)?;
    let handle = start(config, Arc::new(JobManager::default())).await?;
    let connection_url = format!(
        "{}/#companionEndpoint={}&companionCode={}",
        web_origin.trim_end_matches('/'),
        handle.endpoint,
        handle.pairing_code
    );

    println!("GlyphMend Companion E2E host ready.");
    println!("Endpoint: {}", handle.endpoint);
    println!("Connection URL: {}", connection_url);
    tokio::signal::ctrl_c().await?;
    handle.shutdown().await;
    Ok(())
}

fn parse_web_origin(arguments: &[String]) -> Result<String, Box<dyn std::error::Error>> {
    let occurrences = arguments
        .iter()
        .enumerate()
        .filter(|(_, argument)| argument.as_str() == "--web-origin")
        .collect::<Vec<_>>();
    if occurrences.len() > 1 {
        return Err("--web-origin may be specified only once".into());
    }
    let Some((index, _)) = occurrences.first() else {
        return Ok("http://127.0.0.1:5173".to_string());
    };
    arguments
        .get(*index + 1)
        .filter(|value| !value.starts_with("--"))
        .cloned()
        .ok_or_else(|| "--web-origin requires an exact http or https origin".into())
}
