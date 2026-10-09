use bytes::Bytes;
use companion_contract::{
    DocumentExtractionOptions, InputChunk, InputComplete, InputKind, JobCreate, JobResult,
    OcrAccuracy, DOCUMENT_EXTRACTION_CAPABILITY, DOCUMENT_INPUT_SCHEMA,
};
use companion_core::JobState;
use companion_extractor::PdfiumTesseractProvider;
use companion_service::JobManager;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf, sync::Arc};
use uuid::Uuid;

#[tokio::test]
async fn bundled_engine_extracts_digital_text_through_the_shared_job_service() {
    if std::env::var_os("GLYPHMEND_RUNTIME_SMOKE").is_none() {
        return;
    }
    let result = run_job(digital_text_pdf(), false, false).await;
    assert_eq!(result["pages"][0]["nodes"][0]["sourceKind"], "native-text");
    let text = result["pages"][0]["nodes"][0]["content"]["text"]
        .as_str()
        .expect("native text should be present");
    assert!(text.contains("GlyphMend digital extraction smoke test"));
}

#[tokio::test]
async fn bundled_engine_ocr_recognizes_a_raster_only_page() {
    if std::env::var_os("GLYPHMEND_RUNTIME_SMOKE").is_none() {
        return;
    }
    let result = run_job(raster_text_pdf(), true, true).await;
    let fallback = &result["pages"][0]["source"]["fallback"];
    assert_eq!(
        fallback["ocrApplied"], true,
        "packaged OCR produced no text segments; fallback diagnostics: {fallback}"
    );
    assert!(
        fallback["ocrError"].is_null(),
        "packaged OCR reported an error: {fallback}"
    );
    let text = result["pages"][0]["nodes"]
        .as_array()
        .expect("OCR should create text nodes")
        .iter()
        .filter_map(|node| node["content"]["text"].as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let normalized = text
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    assert!(
        normalized.contains("document") && normalized.contains("12345"),
        "OCR did not recover the raster fixture markers `DOCUMENT` and `12345`: {text}; fallback diagnostics: {}",
        fallback
    );
}

async fn run_job(pdf: Vec<u8>, use_ocr: bool, force_ocr: bool) -> serde_json::Value {
    let resource_root = PathBuf::from(
        std::env::var_os("GLYPHMEND_TEST_RESOURCE_DIR")
            .expect("GLYPHMEND_TEST_RESOURCE_DIR must point to packaged resources"),
    );
    let runtime_root = resource_root.join("runtime");
    let pdfium_dir = runtime_root.join("pdfium");
    let tessdata_root = runtime_root.join("tessdata");
    assert!(pdfium_dir.is_dir(), "PDFium resource directory is missing");
    if use_ocr {
        assert!(
            tessdata_root.join("fast/eng.traineddata").is_file(),
            "English OCR model is missing"
        );
    }

    let storage_dir =
        std::env::temp_dir().join(format!("glyphmend-desktop-smoke-{}", Uuid::new_v4()));
    let service = Arc::new(
        JobManager::with_providers(
            vec![Arc::new(PdfiumTesseractProvider::with_runtime_paths(
                pdfium_dir,
                tessdata_root,
            ))],
            storage_dir.clone(),
        )
        .expect("the shared job service should start"),
    );
    let options = DocumentExtractionOptions {
        schema: DOCUMENT_INPUT_SCHEMA.into(),
        selected_pages: vec![1],
        ocr_accuracy: OcrAccuracy::Fast,
        ocr_language: "eng".into(),
        extract_equations: false,
        use_ocr,
        force_ocr,
        password: None,
    };
    let owner = Uuid::nil();
    let job_id = service
        .create(
            owner,
            JobCreate {
                document_name: "runtime-smoke.pdf".into(),
                capability_id: DOCUMENT_EXTRACTION_CAPABILITY.into(),
                input_kind: InputKind::Document,
                declared_bytes: pdf.len() as u64,
                page_count: 1,
                metadata: serde_json::to_value(options).unwrap(),
                idempotency_key: Uuid::new_v4(),
            },
        )
        .await
        .expect("the native extraction job should be accepted");
    service
        .append_chunk(
            owner,
            job_id,
            InputChunk {
                chunk_sequence: 0,
                declared_length: pdf.len() as u32,
            },
            Bytes::from(pdf.clone()),
        )
        .await
        .expect("the PDF bytes should be accepted");
    service
        .complete_input(
            owner,
            job_id,
            InputComplete {
                sha256_hex: hex_digest(&pdf),
                total_bytes: pdf.len() as u64,
            },
        )
        .await
        .expect("the PDF input should be complete");
    service
        .run_queued(job_id)
        .await
        .expect("the native job should run");
    let response = service
        .result(owner, job_id)
        .await
        .expect("the result should be available");
    if response.status != JobState::Completed {
        let events = service
            .events_after(owner, job_id, 0, 64, std::time::Duration::ZERO)
            .await;
        panic!(
            "native extraction ended in {:?}; service events: {events:#?}",
            response.status
        );
    }
    let Some(JobResult::SemanticDocument(result)) = response.result else {
        panic!("the native engine should return the shared Semantic Document IR");
    };
    assert_eq!(
        result["schemaVersion"],
        companion_contract::IR_SCHEMA_VERSION
    );
    service
        .acknowledge_result(owner, job_id)
        .await
        .expect("the result should be acknowledged");
    drop(service);
    let _ = fs::remove_dir_all(storage_dir);
    result
}

fn hex_digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn digital_text_pdf() -> Vec<u8> {
    let text = b"BT /F1 24 Tf 72 700 Td (GlyphMend digital extraction smoke test) Tj ET\n";
    let mut stream = format!("<< /Length {} >>\nstream\n", text.len()).into_bytes();
    stream.extend_from_slice(text);
    stream.extend_from_slice(b"endstream");
    make_pdf(vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_vec(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_vec(),
        stream,
    ])
}

fn raster_text_pdf() -> Vec<u8> {
    include_bytes!("ocr-smoke.pdf").to_vec()
}

fn make_pdf(objects: Vec<Vec<u8>>) -> Vec<u8> {
    let mut output = b"%PDF-1.4\n%GlyphMend smoke\n".to_vec();
    let mut offsets = vec![0usize];
    for (index, object) in objects.iter().enumerate() {
        offsets.push(output.len());
        output.extend_from_slice(format!("{} 0 obj\n", index + 1).as_bytes());
        output.extend_from_slice(object);
        output.extend_from_slice(b"\nendobj\n");
    }
    let xref = output.len();
    output.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    output.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        output.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    output.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    output
}
