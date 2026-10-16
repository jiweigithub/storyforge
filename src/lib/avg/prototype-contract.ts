import type { AnyProductRuntimePackage, ProductBuildQualityReportV1, ProductProductionBriefV3 } from '../types';
import { avgExecutableModule } from './executable-module';
import type { AvgAssemblyBrief } from './assembly-contract';
import { AVG_MEDIA_PRODUCTION_ADMISSION_V2 } from './assembly-contract';
/** This identifies a closed author-owned engineering route. It cannot admit
 * commercial candidates, legacy AVG or arbitrary V2 modules. */
export function isAvgAuthorPrototypeBriefV1(brief: ProductProductionBriefV3): brief is ProductProductionBriefV3 & {
    avgAssembly: AvgAssemblyBrief;
} {
    return brief.intent.productType === 'avg' && brief.qualityProfile === 'prototype' && brief.avgAssembly !== undefined
        && (brief.avgAssembly.version === 1 || brief.avgAssembly.version === 2 && AVG_MEDIA_PRODUCTION_ADMISSION_V2);
}
/** Frozen pre-preview QA is technical only. Real full-catalog decoding and an
 * explicit completed-route author receipt must still qualify it after preview;
 * this predicate never supplies those receipts or changes the frozen report. */
export function avgPrototypeTechnicalQualitySatisfiedV1(input: {
    brief: ProductProductionBriefV3;
    runtimePackage: AnyProductRuntimePackage;
    quality: ProductBuildQualityReportV1;
    buildNumber: number;
    packageHash: string;
}): boolean {
    const { brief, runtimePackage: pkg, quality } = input;
    if (!isAvgAuthorPrototypeBriefV1(brief) || pkg.version !== 2 || !avgExecutableModule(pkg))
        return false;
    const passed = new Set(quality.hardGateResults.filter(gate => gate.passed).map(gate => gate.gateId));
    return quality.buildNumber === input.buildNumber && quality.packageHash === input.packageHash && quality.playable
        && quality.mediaCoverage >= brief.completionContract.minimumMediaCoverage && quality.hardGateResults.every(gate => gate.passed)
        && brief.completionContract.requiredGateIds.every(gate => passed.has(gate));
}
