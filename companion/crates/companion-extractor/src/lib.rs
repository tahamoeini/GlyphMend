//! Native PDF extraction for the optional local Companion.
#![forbid(unsafe_code)]

use anyhow::{anyhow, Context, Result};
use companion_contract::{
    Capability, DocumentExtractionOptions, InputKind, JobResult, Progress, ProviderKind,
    DOCUMENT_EXTRACTION_CAPABILITY, IR_SCHEMA_ID, IR_SCHEMA_VERSION,
};
use companion_core::{
    CapabilityProvider, CoreError, ProgressSender, ProviderInput, ProviderOutput,
};
use image::ImageFormat;
use pdfium_render::prelude::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc::{self, sync_channel},
        Arc, Mutex,
    },
    thread,
};
use tokio_util::sync::CancellationToken;

const ENGINE_ID: &str = "glyphmend.pdfium-tesseract";
const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
const OCR_WORKERS: usize = 2;
const MAX_PAGE_OBJECT_GEOMETRY: usize = 16;
const MAX_PAGE_TEXT_SEGMENTS: usize = 50_000;
const MAX_PAGE_TEXT_BYTES: usize = 4 * 1024 * 1024;
const MAX_PAGE_OBJECTS: usize = 50_000;
const MAX_DOCUMENT_IR_BYTES: usize = 32 * 1024 * 1024;
const MAX_RENDER_DIMENSION: f64 = 4096.0;
const OCR_DPI: f64 = 300.0;
const MIN_NATIVE_TEXT_CHARS: usize = 24;

#[derive(Debug, Default)]
pub struct PdfiumTesseractProvider;

#[derive(Debug, Clone)]
struct TextSegment {
    text: String,
    bbox: [f64; 4],
    source_kind: &'static str,
    confidence: Option<f64>,
    id: String,
}

struct RawPage {
    page_number: u32,
    width: f64,
    height: f64,
    object_count: usize,
    object_types: BTreeMap<String, u32>,
    page_object_geometry: Vec<Value>,
    native_segments: Vec<TextSegment>,
    tiff: Option<Vec<u8>>,
    render_width: u32,
    render_height: u32,
    fallback_reason: String,
    force_ocr: bool,
    ocr_segments: Vec<TextSegment>,
    ocr_error: Option<String>,
    ocr_confidence: Option<f64>,
}

type OcrLine = (String, f64, f64, f64, f64, Vec<f64>);

impl CapabilityProvider for PdfiumTesseractProvider {
    fn capability(&self) -> Capability {
        Capability {
            id: DOCUMENT_EXTRACTION_CAPABILITY.into(),
            version: ENGINE_VERSION.into(),
            provider_kind: ProviderKind::Deterministic,
            input_schema: companion_contract::DOCUMENT_INPUT_SCHEMA.into(),
            output_schema: IR_SCHEMA_ID.into(),
            execution_locations: vec!["companion".into()],
            deterministic: true,
            requires_model: true,
            confidence_calibrated: false,
            privacy_class: "local-only".into(),
            diagnostic_only: false,
            ir_schema_version: IR_SCHEMA_VERSION,
        }
    }

    fn run(
        &self,
        input: ProviderInput,
        cancellation: CancellationToken,
        progress: ProgressSender,
    ) -> std::result::Result<ProviderOutput, CoreError> {
        extract_document(input, cancellation, progress)
            .map_err(|error| CoreError::Provider(error.to_string()))
    }
}

fn extract_document(
    input: ProviderInput,
    cancellation: CancellationToken,
    progress: ProgressSender,
) -> Result<ProviderOutput> {
    if input.input_kind != InputKind::Document
        || input.capability_id != DOCUMENT_EXTRACTION_CAPABILITY
    {
        return Err(anyhow!("document extraction requires a PDF document job"));
    }
    let options: DocumentExtractionOptions = serde_json::from_value(input.metadata.clone())
        .context("invalid document extraction options")?;
    options
        .validate(input.page_count)
        .context("invalid document extraction options")?;
    if cancellation.is_cancelled() {
        return Err(cancelled());
    }
    let mut header = [0u8; 1024];
    let mut file = fs::File::open(&input.input_path).context("could not open uploaded PDF")?;
    use std::io::Read;
    let read = file.read(&mut header)?;
    if !header[..read].windows(5).any(|window| window == b"%PDF-") {
        return Err(anyhow!("uploaded bytes are not a PDF"));
    }

    let pdfium = bind_pdfium()?;
    let document = pdfium
        .load_pdf_from_file(&input.input_path, options.password.as_deref())
        .context("PDFium could not open the uploaded PDF")?;
    let actual_pages = document.pages().len() as u32;
    if actual_pages != input.page_count {
        return Err(anyhow!(
            "PDF page count did not match the declared page count"
        ));
    }

    let tessdata = if options.use_ocr || options.force_ocr {
        Some(resolve_tessdata(
            &options.ocr_accuracy,
            &options.ocr_language,
        )?)
    } else {
        None
    };
    let model_hash = tessdata
        .as_ref()
        .map(|path| sha256_file(&path.join(format!("{}.traineddata", options.ocr_language))))
        .transpose()?;
    let completed = Arc::new(AtomicU32::new(0));
    let total_pages = options.selected_pages.len() as u32;
    let (work_sender, work_receiver) = sync_channel::<RawPage>(OCR_WORKERS);
    let work_receiver = Arc::new(Mutex::new(work_receiver));
    let (result_sender, result_receiver) = mpsc::channel::<Result<Value>>();
    let mut workers = Vec::with_capacity(OCR_WORKERS);
    for worker_index in 0..OCR_WORKERS {
        let receiver = Arc::clone(&work_receiver);
        let sender = result_sender.clone();
        let tessdata = tessdata.clone();
        let model_hash = model_hash.clone();
        let options = options.clone();
        let cancellation = cancellation.clone();
        let progress = progress.clone();
        let completed = Arc::clone(&completed);
        let bytes_received = input.bytes_received;
        workers.push(
            thread::Builder::new()
                .name(format!("glyphmend-ocr-{worker_index}"))
                .spawn(move || loop {
                    let received = receiver.lock().expect("OCR work queue poisoned").recv();
                    let Ok(mut raw) = received else { break };
                    let result = (|| {
                        if cancellation.is_cancelled() {
                            return Err(cancelled());
                        }
                        if let Some(tiff) = raw.tiff.as_deref() {
                            let tessdata = tessdata
                                .as_deref()
                                .ok_or_else(|| anyhow!("OCR model path is unavailable"))?;
                            match recognize_tiff(
                                tessdata,
                                tiff,
                                raw.page_number,
                                raw.render_width,
                                raw.render_height,
                                raw.width,
                                raw.height,
                                &options.ocr_language,
                            ) {
                                Ok((segments, confidence)) => {
                                    raw.ocr_segments = segments;
                                    raw.ocr_confidence = confidence;
                                }
                                Err(error) => raw.ocr_error = Some(error.to_string()),
                            }
                        }
                        if cancellation.is_cancelled() {
                            return Err(cancelled());
                        }
                        let phase = if raw.tiff.is_some() {
                            "ocr-and-reconstruction"
                        } else {
                            "native-text-and-reconstruction"
                        };
                        let page = page_ir(&raw, &options, model_hash.as_deref());
                        let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
                        let _ = progress.send(Progress {
                            phase: phase.into(),
                            completed_pages: done,
                            total_pages,
                            bytes_received,
                        });
                        Ok(page)
                    })();
                    if sender.send(result).is_err() {
                        break;
                    }
                })
                .context("could not start bounded OCR worker")?,
        );
    }
    drop(result_sender);

    let mut submitted_pages = 0usize;
    let mut producer_error = None;
    for &page_number in &options.selected_pages {
        if cancellation.is_cancelled() {
            producer_error = Some(cancelled());
            break;
        }
        let page_result = (|| -> Result<RawPage> {
            let page_index = i32::try_from(page_number - 1).context("PDF page index overflow")?;
            let page = document
                .pages()
                .get(page_index)
                .context("PDFium could not load a page")?;
            let width = f64::from(page.width().value);
            let height = f64::from(page.height().value);
            let mut native_segments = Vec::new();
            let mut native_text_bytes = 0usize;
            let text_page = page.text().context("PDFium could not read page text")?;
            for (index, segment) in text_page.segments().iter().enumerate() {
                if index >= MAX_PAGE_TEXT_SEGMENTS {
                    return Err(anyhow!(
                        "PDF page exceeds the text segment processing limit"
                    ));
                }
                let text = segment.text().trim().to_owned();
                if text.is_empty() {
                    continue;
                }
                native_text_bytes = native_text_bytes.saturating_add(text.len());
                if native_text_bytes > MAX_PAGE_TEXT_BYTES {
                    return Err(anyhow!("PDF page exceeds the extracted text byte limit"));
                }
                let bounds = segment.bounds();
                let left = f64::from(bounds.left().value);
                let right = f64::from(bounds.right().value);
                let top = (height - f64::from(bounds.top().value)).max(0.0);
                let bottom = (height - f64::from(bounds.bottom().value)).min(height);
                native_segments.push(TextSegment {
                    text,
                    bbox: [left.max(0.0), top, right.min(width), bottom.max(top)],
                    source_kind: "native-text",
                    confidence: None,
                    id: format!("pdfium-span-{page_number}-{index}"),
                });
            }
            native_segments.sort_by(|left, right| {
                left.bbox[1]
                    .total_cmp(&right.bbox[1])
                    .then(left.bbox[0].total_cmp(&right.bbox[0]))
            });
            let mut object_types = BTreeMap::new();
            let mut page_object_geometry = Vec::new();
            for (object_index, object) in page.objects().iter().enumerate() {
                if object_index >= MAX_PAGE_OBJECTS {
                    return Err(anyhow!("PDF page exceeds the object processing limit"));
                }
                let object_type = format!("{:?}", object.object_type());
                *object_types.entry(object_type.clone()).or_insert(0) += 1;
                if page_object_geometry.len() == MAX_PAGE_OBJECT_GEOMETRY {
                    continue;
                }
                let bbox = object.bounds().ok().map(|bounds| {
                    [
                        f64::from(bounds.left().value).max(0.0),
                        (height - f64::from(bounds.top().value)).max(0.0),
                        f64::from(bounds.right().value).clamp(0.0, width),
                        (height - f64::from(bounds.bottom().value)).clamp(0.0, height),
                    ]
                });
                page_object_geometry.push(json!({
                    "id": format!("pdfium-object-{page_number}-{object_index}"),
                    "type": object_type,
                    "bbox": bbox,
                    "coordinateSpace": "page-points"
                }));
            }
            let object_count = object_types.values().map(|count| *count as usize).sum();
            let native_chars = native_segments
                .iter()
                .map(|segment| segment.text.chars().count())
                .sum::<usize>();
            let should_ocr =
                options.force_ocr || (options.use_ocr && native_chars < MIN_NATIVE_TEXT_CHARS);
            let fallback_reason = if options.force_ocr {
                "forced-by-user"
            } else if !options.use_ocr {
                "ocr-disabled"
            } else if native_chars < MIN_NATIVE_TEXT_CHARS {
                "no-usable-native-text"
            } else {
                "native-text-present"
            }
            .to_owned();
            let mut tiff = None;
            let mut render_width = 0;
            let mut render_height = 0;
            if should_ocr {
                let scale = (OCR_DPI / 72.0)
                    .min(MAX_RENDER_DIMENSION / width.max(1.0))
                    .min(MAX_RENDER_DIMENSION / height.max(1.0));
                render_width = (width * scale).round().max(1.0) as u32;
                let config = PdfRenderConfig::new().set_target_width(render_width as _);
                let rendered = page
                    .render_with_config(&config)
                    .context("PDFium page rendering failed")?;
                let image = rendered
                    .as_image()
                    .context("PDFium image conversion failed")?;
                render_width = image.width();
                render_height = image.height();
                let mut encoded = Cursor::new(Vec::new());
                image
                    .write_to(&mut encoded, ImageFormat::Tiff)
                    .context("could not encode OCR image")?;
                tiff = Some(encoded.into_inner());
            }
            Ok(RawPage {
                page_number,
                width,
                height,
                object_count,
                object_types,
                page_object_geometry,
                native_segments,
                tiff,
                render_width,
                render_height,
                fallback_reason,
                force_ocr: options.force_ocr,
                ocr_segments: Vec::new(),
                ocr_error: None,
                ocr_confidence: None,
            })
        })();
        let raw = match page_result {
            Ok(raw) => raw,
            Err(error) => {
                producer_error = Some(error);
                break;
            }
        };
        if work_sender.send(raw).is_err() {
            producer_error = Some(anyhow!("all bounded OCR workers stopped unexpectedly"));
            break;
        }
        submitted_pages += 1;
    }
    drop(document);
    drop(work_sender);

    let mut pages = Vec::with_capacity(submitted_pages);
    let mut document_ir_bytes = 0usize;
    for _ in 0..submitted_pages {
        match result_receiver.recv() {
            Ok(Ok(page)) => {
                let page_bytes = serde_json::to_vec(&page)
                    .context("could not measure extracted page output")?
                    .len();
                document_ir_bytes = document_ir_bytes.saturating_add(page_bytes);
                if document_ir_bytes > MAX_DOCUMENT_IR_BYTES {
                    producer_error =
                        Some(anyhow!("extracted document exceeds the IR output limit"));
                    cancellation.cancel();
                    break;
                }
                pages.push(page);
            }
            Ok(Err(error)) => {
                if producer_error.is_none() {
                    producer_error = Some(error);
                }
            }
            Err(_) => {
                if producer_error.is_none() {
                    producer_error =
                        Some(anyhow!("OCR workers stopped before returning every page"));
                }
                break;
            }
        }
    }
    for worker in workers {
        if worker.join().is_err() && producer_error.is_none() {
            producer_error = Some(anyhow!("an OCR worker terminated unexpectedly"));
        }
    }
    if let Some(error) = producer_error {
        return Err(error);
    }
    if cancellation.is_cancelled() {
        return Err(cancelled());
    }
    if pages.len() != options.selected_pages.len() {
        return Err(anyhow!("OCR workers returned an incomplete page set"));
    }
    pages.sort_by_key(|page| page.get("pageNumber").and_then(Value::as_u64).unwrap_or(0));
    let document_ir = json!({
        "schema": IR_SCHEMA_ID,
        "schemaVersion": IR_SCHEMA_VERSION,
        "documentId": format!("pdf-sha256-{}", input.content_hash),
        "metadata": {
            "engine": { "id": ENGINE_ID, "version": ENGINE_VERSION },
            "sourceSha256": input.content_hash,
            "ocr": {
                "language": options.ocr_language,
                "accuracy": match options.ocr_accuracy {
                    companion_contract::OcrAccuracy::Fast => "fast",
                    companion_contract::OcrAccuracy::HighAccuracy => "high-accuracy",
                },
                "modelSha256": model_hash,
                "fastModel": "tessdata_fast",
                "highAccuracyModel": "tessdata_best"
            }
        },
        "pages": pages,
        "diagnostics": []
    });
    let result = JobResult::SemanticDocument(document_ir);
    Ok(ProviderOutput {
        progress: Vec::new(),
        result: Some(result),
    })
}

static PDFIUM_BINDING: std::sync::OnceLock<std::result::Result<Pdfium, String>> =
    std::sync::OnceLock::new();

fn bind_pdfium() -> Result<&'static Pdfium> {
    match PDFIUM_BINDING.get_or_init(|| bind_pdfium_library().map_err(|error| format!("{error:#}")))
    {
        Ok(pdfium) => Ok(pdfium),
        Err(error) => Err(anyhow!(error.clone())),
    }
}

fn bind_pdfium_library() -> Result<Pdfium> {
    let executable_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."));
    let library = Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(
        &executable_dir,
    ))
    .or_else(|_| Pdfium::bind_to_system_library())
    .context("PDFium runtime is missing beside the Companion executable")?;
    Ok(Pdfium::new(library))
}

fn resolve_tessdata(accuracy: &companion_contract::OcrAccuracy, language: &str) -> Result<PathBuf> {
    let model_set = match accuracy {
        companion_contract::OcrAccuracy::Fast => "fast",
        companion_contract::OcrAccuracy::HighAccuracy => "best",
    };
    let root = std::env::var_os("GLYPHMEND_TESSDATA_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|path| path.parent().map(Path::to_path_buf))
                .map(|path| path.join("tessdata"))
        })
        .ok_or_else(|| anyhow!("could not locate Companion model directory"))?;
    let path = root.join(model_set);
    if !path.join(format!("{language}.traineddata")).is_file() {
        return Err(anyhow!(
            "bundled {language} {model_set} OCR model is missing"
        ));
    }
    Ok(path)
}

fn sha256_file(path: &Path) -> Result<String> {
    let bytes =
        fs::read(path).with_context(|| format!("could not read OCR model {}", path.display()))?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn recognize_tiff(
    tessdata: &Path,
    tiff: &[u8],
    page_number: u32,
    render_width: u32,
    render_height: u32,
    page_width: f64,
    page_height: f64,
    language: &str,
) -> Result<(Vec<TextSegment>, Option<f64>)> {
    let data_path = tessdata
        .to_str()
        .ok_or_else(|| anyhow!("OCR model path is not valid UTF-8"))?;
    let mut tesseract = leptess::LepTess::new(Some(data_path), language)
        .map_err(|error| anyhow!("could not initialize {language} OCR: {error}"))?;
    tesseract
        .set_image_from_mem(tiff)
        .context("Tesseract could not read the rendered page")?;
    tesseract.set_source_resolution(OCR_DPI as i32);
    let tsv = tesseract
        .get_tsv_text(0)
        .context("Tesseract could not return OCR text")?;
    let x_scale = page_width / f64::from(render_width.max(1));
    let y_scale = page_height / f64::from(render_height.max(1));
    let mut lines: BTreeMap<(u32, u32, u32), OcrLine> = BTreeMap::new();
    for row in tsv.lines().skip(1) {
        let fields = row.splitn(12, '\t').collect::<Vec<_>>();
        if fields.len() != 12 || fields[0] != "5" {
            continue;
        }
        let text = fields[11].trim();
        let confidence = fields[10].parse::<f64>().unwrap_or(-1.0);
        if text.is_empty() || confidence < 0.0 {
            continue;
        }
        let block = fields[2].parse::<u32>().unwrap_or(0);
        let paragraph = fields[3].parse::<u32>().unwrap_or(0);
        let line = fields[4].parse::<u32>().unwrap_or(0);
        let left = fields[6].parse::<f64>().unwrap_or(0.0);
        let top = fields[7].parse::<f64>().unwrap_or(0.0);
        let right = left + fields[8].parse::<f64>().unwrap_or(0.0);
        let bottom = top + fields[9].parse::<f64>().unwrap_or(0.0);
        let entry = lines
            .entry((block, paragraph, line))
            .or_insert_with(|| (String::new(), left, top, right, bottom, Vec::new()));
        if !entry.0.is_empty() {
            entry.0.push(' ');
        }
        entry.0.push_str(text);
        entry.1 = entry.1.min(left);
        entry.2 = entry.2.min(top);
        entry.3 = entry.3.max(right);
        entry.4 = entry.4.max(bottom);
        entry.5.push(confidence / 100.0);
    }
    let mut segments = Vec::with_capacity(lines.len());
    let mut all_confidence = Vec::new();
    for (index, (_, (text, left, top, right, bottom, confidence))) in lines.into_iter().enumerate()
    {
        let mean = confidence.iter().sum::<f64>() / confidence.len().max(1) as f64;
        all_confidence.push(mean);
        segments.push(TextSegment {
            text: text.trim().to_owned(),
            bbox: [
                left * x_scale,
                top * y_scale,
                right * x_scale,
                bottom * y_scale,
            ],
            source_kind: "ocr-text",
            confidence: Some(mean.clamp(0.0, 1.0)),
            id: format!("tesseract-line-{page_number}-{index}"),
        });
    }
    let mean = (!all_confidence.is_empty())
        .then(|| all_confidence.iter().sum::<f64>() / all_confidence.len() as f64);
    Ok((segments, mean))
}

fn formula_markdown(text: &str, enabled: bool) -> Option<String> {
    if !enabled {
        return None;
    }
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars = normalized.chars().collect::<Vec<_>>();
    if chars.len() < 3 || chars.len() > 240 || normalized.split_whitespace().count() > 18 {
        return None;
    }

    let is_relation = chars
        .iter()
        .any(|ch| matches!(ch, '=' | '<' | '>' | '≤' | '≥' | '≠' | '≈'));
    let operator_count = chars
        .iter()
        .filter(|ch| {
            matches!(
                ch,
                '=' | '<'
                    | '>'
                    | '≤'
                    | '≥'
                    | '≠'
                    | '≈'
                    | '+'
                    | '-'
                    | '−'
                    | '*'
                    | '/'
                    | '×'
                    | '÷'
                    | '^'
                    | '_'
                    | '∑'
                    | '∏'
                    | '∫'
                    | '√'
            )
        })
        .count();
    let has_script = chars.iter().any(|ch| matches!(ch, '^' | '_'));
    if (!is_relation && operator_count < 2 && !has_script) || operator_count == 0 {
        return None;
    }

    let functions = [
        "sin", "cos", "tan", "log", "ln", "exp", "max", "min", "sqrt", "frac", "alpha", "beta",
        "gamma", "delta", "theta", "lambda", "mu", "pi", "sigma", "omega",
    ];
    let contains_prose = normalized.split_whitespace().any(|token| {
        let letters = token.chars().filter(|ch| ch.is_alphabetic()).count();
        let lowercase = token.trim_start_matches('\\').to_ascii_lowercase();
        letters > 3 && !functions.contains(&lowercase.as_str())
    });
    if (contains_prose && operator_count < 2)
        || normalized.contains('?')
        || normalized.contains('!')
    {
        return None;
    }

    let mut latex = square_root_latex(&normalized);
    for (symbol, replacement) in [
        ("≤", r"\leq"),
        ("≥", r"\geq"),
        ("≠", r"\neq"),
        ("≈", r"\approx"),
        ("×", r"\times"),
        ("÷", r"\div"),
        ("∑", r"\sum"),
        ("∏", r"\prod"),
        ("∫", r"\int"),
        ("∞", r"\infty"),
    ] {
        latex = latex.replace(symbol, replacement);
    }
    Some(format!("$$\n{latex}\n$$"))
}

fn square_root_latex(text: &str) -> String {
    let chars = text.chars().collect::<Vec<_>>();
    let mut output = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '√' {
            output.push(chars[index]);
            index += 1;
            continue;
        }

        let mut start = index + 1;
        while chars.get(start).is_some_and(|ch| ch.is_whitespace()) {
            start += 1;
        }
        if start >= chars.len() {
            output.push('√');
            index += 1;
            continue;
        }

        let close = match chars[start] {
            '(' => Some(')'),
            '[' => Some(']'),
            '{' => Some('}'),
            _ => None,
        };
        if let Some(close) = close {
            let open = chars[start];
            let mut depth = 0;
            let mut end = start;
            while end < chars.len() {
                if chars[end] == open {
                    depth += 1;
                } else if chars[end] == close {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                end += 1;
            }
            if end < chars.len() {
                output.push_str(r"\sqrt{");
                output.extend(chars[start + 1..end].iter().copied());
                output.push('}');
                index = end + 1;
                continue;
            }
            output.push('√');
            index += 1;
            continue;
        }

        let mut end = start;
        while end < chars.len()
            && !chars[end].is_whitespace()
            && !matches!(
                chars[end],
                '=' | '<'
                    | '>'
                    | '≤'
                    | '≥'
                    | '≠'
                    | '≈'
                    | '+'
                    | '−'
                    | '-'
                    | '*'
                    | '/'
                    | '×'
                    | '÷'
                    | ','
                    | ';'
            )
        {
            end += 1;
        }
        if end == start {
            output.push('√');
            index += 1;
            continue;
        }
        output.push_str(r"\sqrt{");
        output.extend(chars[start..end].iter().copied());
        output.push('}');
        index = end;
    }
    output
}

fn page_ir(raw: &RawPage, options: &DocumentExtractionOptions, model_hash: Option<&str>) -> Value {
    let used_ocr = raw.tiff.is_some() && raw.ocr_error.is_none();
    let segments = if (raw.force_ocr && used_ocr) || raw.native_segments.is_empty() {
        &raw.ocr_segments
    } else {
        &raw.native_segments
    };
    let nodes = segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            let text = segment.text.trim();
            let equation = formula_markdown(text, options.extract_equations);
            let node_type = if equation.is_some() { "equation" } else { "paragraph" };
            let markdown = equation.as_deref().unwrap_or(text);
            let diagnostics = if equation.is_some() {
                vec![json!({
                    "code": "FORMULA_RECONSTRUCTION_NEEDS_REVIEW",
                    "severity": "info",
                    "message": "Formula text is exported as LaTeX-compatible math. Compare it with the source PDF page."
                })]
            } else {
                Vec::new()
            };
            json!({
                "id": format!("companion-page-{}-segment-{index}", raw.page_number),
                "type": node_type,
                "content": { "markdown": markdown, "text": text },
                "sourcePage": raw.page_number,
                "bbox": segment.bbox,
                "coordinateSpace": "page-points",
                "sourceKind": segment.source_kind,
                "source": {
                    "spanIds": [segment.id],
                    "extra": {
                        "engine": ENGINE_ID,
                        "engineVersion": ENGINE_VERSION,
                        "fallbackReason": raw.fallback_reason
                    }
                },
                "confidence": {
                    "extraction": segment.confidence,
                    "structure": null,
                    "reconstruction": null,
                    "export": null
                },
                "disposition": if equation.is_some() { "needs-review" } else { "reconstructed" },
                "reconstructionVersion": 2,
                "diagnostics": diagnostics
            })
        })
        .collect::<Vec<_>>();
    let mut diagnostics = Vec::new();
    if nodes.is_empty() {
        diagnostics.push(json!({
            "code": "NO_RECOGNIZED_TEXT",
            "severity": "warning",
            "message": format!("No text was recovered by PDFium or {} OCR on this page.", options.ocr_language)
        }));
    }
    if let Some(error) = &raw.ocr_error {
        diagnostics.push(json!({
            "code": "OCR_FAILED",
            "severity": "warning",
            "message": format!("{} OCR failed for this page.", options.ocr_language),
            "details": { "reason": error }
        }));
    }
    json!({
        "id": format!("companion-page-{}", raw.page_number),
        "pageNumber": raw.page_number,
        "sourcePage": raw.page_number,
        "bbox": [0.0, 0.0, raw.width, raw.height],
        "coordinateSpace": "page-points",
        "nodes": nodes,
        "relationships": [],
        "diagnostics": diagnostics,
        "layout": {
            "engine": ENGINE_ID,
            "engineVersion": ENGINE_VERSION,
            "readingOrderMethod": "top-to-bottom-then-left-to-right",
            "pageObjectCount": raw.object_count,
            "pageObjectTypes": raw.object_types,
            "pageObjectGeometry": raw.page_object_geometry,
            "pageObjectGeometryTruncated": raw.object_count > MAX_PAGE_OBJECT_GEOMETRY
        },
        "source": {
            "engine": ENGINE_ID,
            "engineVersion": ENGINE_VERSION,
            "fallback": {
                "reason": raw.fallback_reason,
                "ocrRequested": options.use_ocr || options.force_ocr,
                "ocrAttempted": raw.tiff.is_some(),
                "ocrApplied": used_ocr && !raw.ocr_segments.is_empty(),
                "ocrAccuracy": match options.ocr_accuracy {
                    companion_contract::OcrAccuracy::Fast => "fast",
                    companion_contract::OcrAccuracy::HighAccuracy => "high-accuracy"
                },
                "ocrModel": if raw.tiff.is_some() { model_hash } else { None },
                "ocrConfidence": raw.ocr_confidence,
                "ocrError": raw.ocr_error
            }
        }
    })
}

fn cancelled() -> anyhow::Error {
    anyhow!("extraction cancelled")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_shared_semantic_ir_v2_conformance_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../fixtures/semantic-document-ir/v2/conformance.json"
        ))
        .expect("conformance fixture is valid JSON");
        JobResult::SemanticDocument(fixture)
            .validate()
            .expect("shared Semantic Document IR v2 fixture is valid");
    }
}
