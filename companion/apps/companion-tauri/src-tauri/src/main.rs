//! Tauri adapter only. Commands delegate to the shared service layer.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

use companion_contract::{InputChunk, InputComplete, JobCreate, MAX_CHUNK_BYTES};
use companion_core::DiagnosticMockProvider;
use companion_extractor::PdfiumTesseractProvider;
use companion_service::{EventsPage, JobManager, JobResultResponse};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tauri::State;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const MAX_TAURI_IPC_PART_BYTES: usize = 64 * 1024;
const MAX_TAURI_IPC_PARTS: usize = 16;
const MAX_PENDING_TAURI_CHUNKS: usize = 8;

struct PendingChunkParts {
    total_bytes: usize,
    parts: Vec<Option<Vec<u8>>>,
}

struct Runtime(
    Arc<JobManager>,
    CancellationToken,
    tokio::sync::Mutex<HashMap<(Uuid, u64), PendingChunkParts>>,
);

impl Drop for Runtime {
    fn drop(&mut self) {
        self.1.cancel();
    }
}

#[tauri::command]
async fn companion_capabilities(
    runtime: State<'_, Runtime>,
) -> Result<Vec<companion_contract::Capability>, String> {
    runtime.0.capabilities().map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_create_job(
    runtime: State<'_, Runtime>,
    request: JobCreate,
) -> Result<String, String> {
    runtime
        .0
        .create(Uuid::nil(), request)
        .await
        .map(|id| id.to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_append_chunk(
    runtime: State<'_, Runtime>,
    job_id: String,
    sequence: u64,
    part_index: u16,
    part_count: u16,
    body: Vec<u8>,
) -> Result<(), String> {
    let id = parse_job_id(&job_id)?;
    let complete = append_chunk_part(
        &mut runtime.2.lock().await,
        id,
        sequence,
        part_index,
        part_count,
        body,
    )?;
    let Some(body) = complete else {
        return Ok(());
    };
    runtime
        .0
        .append_chunk(
            Uuid::nil(),
            id,
            InputChunk {
                chunk_sequence: sequence,
                declared_length: body.len() as u32,
            },
            body.into(),
        )
        .await
        .map_err(|error| error.to_string())
}

fn append_chunk_part(
    pending: &mut HashMap<(Uuid, u64), PendingChunkParts>,
    job_id: Uuid,
    sequence: u64,
    part_index: u16,
    part_count: u16,
    body: Vec<u8>,
) -> Result<Option<Vec<u8>>, String> {
    let part_count = usize::from(part_count);
    let part_index = usize::from(part_index);
    if part_count == 0
        || part_count > MAX_TAURI_IPC_PARTS
        || part_index >= part_count
        || body.len() > MAX_TAURI_IPC_PART_BYTES
    {
        return Err("invalid or oversized Tauri input chunk part".into());
    }
    let key = (job_id, sequence);
    if let Some(existing) = pending.get(&key) {
        if existing.parts.len() != part_count {
            pending.remove(&key);
            return Err("Tauri input chunk part count changed".into());
        }
        if let Some(previous) = &existing.parts[part_index] {
            return if previous == &body {
                Ok(None)
            } else {
                Err("conflicting duplicate Tauri input chunk part".into())
            };
        }
        if existing.total_bytes + body.len() > MAX_CHUNK_BYTES {
            pending.remove(&key);
            return Err("input chunk exceeds 1 MiB".into());
        }
    }
    if !pending.contains_key(&key) && pending.len() >= MAX_PENDING_TAURI_CHUNKS {
        return Err("too many incomplete Tauri input chunks".into());
    }
    let entry = pending.entry(key).or_insert_with(|| PendingChunkParts {
        total_bytes: 0,
        parts: vec![None; part_count],
    });
    entry.total_bytes += body.len();
    entry.parts[part_index] = Some(body);
    if entry.parts.iter().any(Option::is_none) {
        return Ok(None);
    }
    let completed = pending
        .remove(&key)
        .expect("completed chunk parts must exist");
    let mut bytes = Vec::with_capacity(completed.total_bytes);
    for part in completed.parts {
        bytes.extend(part.expect("all completed chunk parts must be present"));
    }
    Ok(Some(bytes))
}

#[tauri::command]
async fn companion_complete_job(
    runtime: State<'_, Runtime>,
    job_id: String,
    request: InputComplete,
) -> Result<(), String> {
    let id = parse_job_id(&job_id)?;
    let should_run = runtime
        .0
        .complete_input(Uuid::nil(), id, request)
        .await
        .map_err(|error| error.to_string())?;
    if should_run {
        let service = Arc::clone(&runtime.0);
        tauri::async_runtime::spawn(async move {
            let _ = service.run_queued(id).await;
        });
    }
    Ok(())
}

#[tauri::command]
async fn companion_job_events(
    runtime: State<'_, Runtime>,
    job_id: String,
    after: u64,
    wait_ms: u64,
) -> Result<EventsPage, String> {
    let id = parse_job_id(&job_id)?;
    runtime
        .0
        .events_after(
            Uuid::nil(),
            id,
            after,
            128,
            Duration::from_millis(wait_ms.min(15_000)),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_job_result(
    runtime: State<'_, Runtime>,
    job_id: String,
) -> Result<JobResultResponse, String> {
    runtime
        .0
        .result(Uuid::nil(), parse_job_id(&job_id)?)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_acknowledge_result(
    runtime: State<'_, Runtime>,
    job_id: String,
) -> Result<(), String> {
    runtime
        .0
        .acknowledge_result(Uuid::nil(), parse_job_id(&job_id)?)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn companion_cancel_job(runtime: State<'_, Runtime>, job_id: String) -> Result<(), String> {
    runtime
        .0
        .cancel(Uuid::nil(), parse_job_id(&job_id)?)
        .await
        .map_err(|error| error.to_string())
}

fn parse_job_id(value: &str) -> Result<Uuid, String> {
    value
        .parse()
        .map_err(|_| "The companion rejected the job identifier.".into())
}

fn main() {
    let service = Arc::new(
        JobManager::with_default_storage_providers(vec![
            Arc::new(DiagnosticMockProvider),
            Arc::new(PdfiumTesseractProvider),
        ])
        .expect("companion temporary storage must be creatable"),
    );
    let cleanup_cancellation = CancellationToken::new();
    tauri::async_runtime::spawn(Arc::clone(&service).cleanup_loop(cleanup_cancellation.clone()));
    tauri::Builder::default()
        .manage(Runtime(
            service,
            cleanup_cancellation,
            tokio::sync::Mutex::new(HashMap::new()),
        ))
        .invoke_handler(tauri::generate_handler![
            companion_capabilities,
            companion_create_job,
            companion_append_chunk,
            companion_complete_job,
            companion_job_events,
            companion_job_result,
            companion_acknowledge_result,
            companion_cancel_job
        ])
        .run(tauri::generate_context!())
        .expect("Tauri companion could not start");
}

#[cfg(test)]
mod tests {
    use super::{append_chunk_part, PendingChunkParts, MAX_PENDING_TAURI_CHUNKS};
    use std::collections::HashMap;
    use uuid::Uuid;

    #[test]
    fn bounded_parts_reassemble_in_order_and_accept_identical_duplicates() {
        let mut pending: HashMap<(Uuid, u64), PendingChunkParts> = HashMap::new();
        let job = Uuid::new_v4();
        assert_eq!(
            append_chunk_part(&mut pending, job, 4, 1, 3, vec![2]).unwrap(),
            None
        );
        assert_eq!(
            append_chunk_part(&mut pending, job, 4, 1, 3, vec![2]).unwrap(),
            None
        );
        assert_eq!(
            append_chunk_part(&mut pending, job, 4, 0, 3, vec![1]).unwrap(),
            None
        );
        assert_eq!(
            append_chunk_part(&mut pending, job, 4, 2, 3, vec![3]).unwrap(),
            Some(vec![1, 2, 3]),
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn invalid_and_conflicting_parts_are_rejected() {
        let mut pending: HashMap<(Uuid, u64), PendingChunkParts> = HashMap::new();
        let job = Uuid::new_v4();
        assert!(append_chunk_part(&mut pending, job, 0, 0, 0, vec![1]).is_err());
        assert!(append_chunk_part(&mut pending, job, 0, 1, 1, vec![1]).is_err());
        assert_eq!(
            append_chunk_part(&mut pending, job, 1, 0, 2, vec![1]).unwrap(),
            None
        );
        assert!(append_chunk_part(&mut pending, job, 1, 0, 2, vec![9]).is_err());
    }

    #[test]
    fn incomplete_chunk_assemblies_have_a_fixed_memory_bound() {
        let mut pending: HashMap<(Uuid, u64), PendingChunkParts> = HashMap::new();
        let job = Uuid::new_v4();
        for sequence in 0..MAX_PENDING_TAURI_CHUNKS as u64 {
            assert_eq!(
                append_chunk_part(&mut pending, job, sequence, 0, 2, vec![1]).unwrap(),
                None
            );
        }
        assert!(append_chunk_part(
            &mut pending,
            job,
            MAX_PENDING_TAURI_CHUNKS as u64,
            0,
            2,
            vec![1],
        )
        .is_err());
    }
}
