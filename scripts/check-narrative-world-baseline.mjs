import { validateNarrativeBaselineFiles } from './narrative-world-baseline-contract.mjs'

try {
  const { counts } = validateNarrativeBaselineFiles()
  console.log(`NW-0B corpus check passed: ${counts.families} families (${counts.holdoutFamilies} held out), ${counts.queries} queries, ${counts.edits} edits; original evidence hashes and spans verified`)
} catch (error) {
  console.error(`NW-0B corpus check failed: ${error.message}`)
  process.exitCode = 1
}
