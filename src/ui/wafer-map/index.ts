export { BaseCanvas, type BaseCanvasProps } from './BaseCanvas';
export { OverlayCanvas, type OverlayCanvasProps } from './OverlayCanvas';
export { WaferMapCanvas, type WaferMapCanvasProps } from './WaferMapCanvas';
export { WaferSelector, type WaferSelectorProps } from './WaferSelector';
export {
  buildFailBinRankMap,
  type Canvas2DContextLike,
  type CanvasPixelDimensions,
  computeParametricRange,
  computeWaferNotchGeometry,
  computeWaferRadiusUnits,
  computeWaferRenderLayout,
  DEFAULT_VIEWPORT_TRANSFORM,
  type DieCanvasRect,
  dieCoordToCanvasRect,
  FAIL_MICRO_DOT_MIN_PITCH_PX,
  hitTestWaferDie,
  OVERLAY_HALO_STROKE,
  OVERLAY_HOVER_STROKE,
  type PaintWaferBaseParams,
  type PaintWaferOverlayParams,
  paintWaferBaseLayer,
  paintWaferOverlayLayer,
  type ParametricRange,
  projectBrushToCanvasRect,
  resolveCanvasPixelSize,
  resolveDieFillColor,
  resolvePassFailDieColor,
  shouldDrawFailMicroDot,
  type ViewportTransform,
  WAFER_STREET_WIDTH_PX,
  type WaferNotchGeometry,
  type WaferRenderLayout,
} from './wafer-geometry';
