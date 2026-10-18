/** Internal S2 design contract/source/candidate API. Production start and
 * canonical draft adoption remain separate; no public product route yet. */
export * from './open-authoring-design-contract'
export * from './open-authoring-design-source'
export * from './open-authoring-design-harness'
export { adoptTtrpgOpenAuthoringDesignV1, reconcileTtrpgOpenAuthoringDesignAdoptionV1,
  readTtrpgOpenAuthoringDesignAdoptionV1, dismissTtrpgOpenAuthoringDesignRequestV1 } from './open-authoring-design-adoption'
