/** Filenames as Forge expects them in `sd_vae` / `forge_additional_modules` (not full paths). */
export const WAN_DEFAULT_VAE_FILENAME = "wan_2.1_vae.safetensors";

export const WAN_DEFAULT_TEXT_ENCODER_FILENAME =
  "umt5_xxl_fp8_e4m3fn_scaled.safetensors";

export function wanDefaultVaeSelectItem(): { value: string; label: string } {
  return {
    value: WAN_DEFAULT_VAE_FILENAME,
    label: `WAN 2.1 VAE (${WAN_DEFAULT_VAE_FILENAME})`,
  };
}

export function wanDefaultTextEncoderSelectItem(): { value: string; label: string } {
  return {
    value: WAN_DEFAULT_TEXT_ENCODER_FILENAME,
    label: `UMT5 XXL FP8 (${WAN_DEFAULT_TEXT_ENCODER_FILENAME})`,
  };
}
