/**
 * The web's typed transitions (part 14) on the phone compositor (ticket MA62 decision 7).
 *
 * On the web a transition is not a separate shader: `previewEngine.ts` `transitionFrameState` (the
 * single TS source of truth, copied here byte for byte) turns the type and progress into per-layer
 * modifications, `clipTransitionState` applies them to each clip, and `buildLayersAtTime` (the web's
 * mirror of `buildGLLayer`, also copied) folds them into the layers the ONE fragment shader of
 * `glCompositor.ts` draws:
 * - alpha (crossDissolve, the dips' cut): `uOpacity` = clip opacity x transition alpha;
 * - offsets (push, slide): the quad's position (`transform.x/y` + offset) in `quadGeometry`;
 * - the wipe reveal (wipe*): `uHasWipe` + `uWipe`, a canvas-space mask;
 * - the dip colour (dipToBlack / dipToWhite): an extra full-canvas layer, `uHasSolid` + `uSolidColor`.
 *
 * The phone runs the same copied code to build the same layers, and draws them with the S2 stages:
 * alpha and the wipe mask in `shaders/alpha.ts`, offsets in `shaders/geometry.ts` (via
 * `uniforms.ts` `layerQuad`, the port of `quadGeometry`), and the dip's colour as the chain's solid
 * source (`compositor.ts` `setSource`). This table is what the parity suite
 * (`__tests__/transitionParity.test.ts`) walks: every type, its stages, and the tolerance row
 * (`03-parity-tolerances.md`) it is held to.
 */
import type { StudioTransitionType } from '../../../studioTypes';

export interface TransitionPort {
  /** The phone stages (SkSL files) that draw it. */
  stages: readonly ('alpha' | 'geometry' | 'solid source')[];
  /** The tolerance row (`parityTolerances.ts`); crossDissolve rides `opacity_dissolve` (the row's own note). */
  row:
    | 'opacity_dissolve'
    | 'transition_dip'
    | 'transition_wipe'
    | 'transition_push'
    | 'transition_slide';
}

export const TRANSITION_PORTS: Record<StudioTransitionType, TransitionPort> = {
  crossDissolve: { stages: ['alpha'], row: 'opacity_dissolve' },
  dipToBlack: { stages: ['alpha', 'solid source'], row: 'transition_dip' },
  dipToWhite: { stages: ['alpha', 'solid source'], row: 'transition_dip' },
  wipeLeft: { stages: ['alpha'], row: 'transition_wipe' },
  wipeRight: { stages: ['alpha'], row: 'transition_wipe' },
  wipeUp: { stages: ['alpha'], row: 'transition_wipe' },
  wipeDown: { stages: ['alpha'], row: 'transition_wipe' },
  pushLeft: { stages: ['geometry'], row: 'transition_push' },
  pushRight: { stages: ['geometry'], row: 'transition_push' },
  pushUp: { stages: ['geometry'], row: 'transition_push' },
  pushDown: { stages: ['geometry'], row: 'transition_push' },
  slideLeft: { stages: ['geometry'], row: 'transition_slide' },
  slideRight: { stages: ['geometry'], row: 'transition_slide' },
  slideUp: { stages: ['geometry'], row: 'transition_slide' },
  slideDown: { stages: ['geometry'], row: 'transition_slide' },
};
