# Media providers and voice messages

`media-provider-catalog.json` records plugin-backed IMAGE_GENERATION, TTS and ASR adapters. Its deployed catalog is stored in `byai_system_config_list` groups `SYSTEM_MODEL_<TYPE>_PROVIDER_NAME`; `param_desc` contains adapter/protocol/endpoint/model/option/logo metadata. The frontend reads these groups rather than replacing returned providers with a fixed image list. Add future adapter capabilities to the catalog and a versioned DML migration together. Public endpoints are examples; credentials belong in model management.

V0.6.0 adds the ASR model type and refreshes only the three media provider groups. Apply the requested version through the normal migration workflow; do not manually edit initdb or `.applied`. Choose an enabled default independently for each model type. ASR uses the global default; existing image/TTS personal connector precedence remains supported.

Voice messages are uploaded as owned MP3 files. Backend transcription and model diagnostics proxy to authenticated Harness plugin adapters. Original audio and cached transcripts live under `session_root/asr/`, generated images under `image/`, and spoken response summaries under `tts/`. See each plugin README for provider-specific configuration and limitations.
