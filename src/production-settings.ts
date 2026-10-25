import type { Aspect, ProductionSettings } from "./web-contract.js";

export const LEGACY_DOODLE_STYLE = "Minimalist hand-drawn stick-figure doodles on a warm white background. Thick clean black lines, one purple accent color, simple flat composition, consistent character proportions. No text, labels, watermarks, borders, or photorealism.";

export const ART_STYLES = {
  doodle: "Minimalist hand-drawn educational doodles of the specified subject on warm white paper. Thick clean black outlines, a single purple accent, simple readable shapes and flat composition. No text, labels, watermarks, borders or photorealism.",
  vector: "Flat editorial vector-style illustration of the specified subject. Warm cream background, deep navy outlines, muted teal and coral accents, geometric shapes, minimal shading and uncluttered composition. No text or watermarks.",
  pencil: "Colored-pencil storybook illustration of the specified subject on warm ivory paper. Soft hand-drawn outlines, restrained lavender and forest-green palette, gentle pencil shading and generous empty space. No text or watermarks.",
  cinematic: "Cinematic painted illustration of the specified subject with warm amber key light and cool blue shadows. Restrained color palette, clear focal subject and simple background. No text or watermarks.",
};
export const DIMENSIONS: Record<Aspect, { width: number; height: number }> = {
  landscape: { width: 1280, height: 720 }, square: { width: 1024, height: 1024 }, portrait: { width: 720, height: 1280 },
};
export const IMAGE_MODELS = {
  "black-forest-labs/flux.1-schnell": "FLUX.1 Schnell · budget default",
  "black-forest-labs/flux.2-klein-4b": "FLUX.2 Klein 4B · alternative",
  "tongyi-mai/z-image-turbo": "Z-Image Turbo · alternative",
  "openai/gpt-image-1-mini": "GPT Image 1 Mini · alternative",
};
export const DEFAULT_SETTINGS: ProductionSettings = {
  imageModel: "black-forest-labs/flux.1-schnell", textStyle: "auto",
  style: ART_STYLES.doodle, imageAspect: "landscape", videoAspect: "landscape",
  voiceId: "JBFqnCBsd6RMkjVDRZzb", model: "eleven_flash_v2_5", fallbackText: false,
};
