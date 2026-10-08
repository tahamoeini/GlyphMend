fn main() {
    println!("cargo:rerun-if-env-changed=CARGO_CFG_TARGET_OS");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // Static libarchive/libcurl call these SDK APIs. tesseract-sys's vcpkg
        // discovery links the native archives but omits their system imports.
        for library in ["xmllite", "iphlpapi", "crypt32", "secur32"] {
            println!("cargo:rustc-link-lib={library}");
        }
    }
}
