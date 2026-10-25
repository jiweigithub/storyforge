/** AVG-04A.27a.1: experimental headless pixel/PNG foundation only.
 * No formal Plan admission, model call, DB write, author choice or UI route.
 * The future durable adapter must separately prove both exact Work inputs,
 * freeze the recipe and budget, and own Worker cancellation and result admission. */
export { AVG_REGION_COMPOSITE_ALGORITHM_V1, AVG_REGION_COMPOSITE_PIXEL_LIMIT_V1,
  parseAvgImageRegionCompositeRecipeV3, deriveAvgRegionCompositeGeometryV1,
  type AvgImageRegionCompositeRecipeV3, type AvgRegionRectV1, type AvgRegionCompositeGeometryV1 } from './image-region-composite-contract'
export { composeAvgCharacterRegionsV1, type AvgCompositeRasterV1 } from './image-region-composite-kernel'
export { AVG_STRAIGHT_PNG_CODEC_V1, decodeAvgStraightPngV1, encodeAvgStraightPngV1 } from './image-straight-png'
