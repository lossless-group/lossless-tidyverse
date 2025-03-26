# Purpose of the Tidyverse
In order to use AI to generate tons of content, one must keep your content clean and consistent and version controlled.  

It's a pain, and it involves a lot of scripting and command line work. 

Let's aggregate all that here.  

# Directory Structure

<pre>
<span style="font-weight:bold;color:teal;">.</span>
|-- 2025-03-25_tree--scripts.html
|-- 2025-03-26_tree-tidyverse.html
|-- <span style="font-weight:bold;color:teal;">changelog-scripts</span>
|   `-- runChangelogSinceLastCheckpoint.cjs
|-- README.md
`-- <span style="font-weight:bold;color:teal;">tidy-up</span>
    |-- <span style="font-weight:bold;color:teal;">assure-tidy-frontmatter-delimiters</span>
    |   |-- detectYoutubeUrlsAsKeyLinesInFrontmatter.cjs
    |   |-- removeBrokenYoutubeUrlsInsideFrontmatter.cjs
    |   `-- removeTwoBackToBackFrontmatterDelimiters.cjs
    |-- attemptToFixKnownErrorsInYAML.cjs
    |-- cleanAfterObsidianFileConflicts.cjs
    |-- detectFrontmatterFormatting.cjs
    |-- isolateAndCleanYAMLFormattingOnly.cjs
    |-- listAllUsedPropertyNamesEverywhere.cjs
    |-- runPropertyFixes.cjs
    |-- <span style="font-weight:bold;color:teal;">standarize-svgs</span>
    |   |-- cleanup-trademarks_02.sh
    |   |-- <span style="color:red;">cleanup-trademarks.sh</span>
    |   |-- convertVisualsToAstro.cjs
    |   |-- setHeightForFixedHeightTrademarks.cjs
    |   `-- tidyUpSVGsForRibbon.cjs
    |-- <span style="font-weight:bold;color:teal;">tidy-one-property</span>
    |   |-- <span style="font-weight:bold;color:teal;">assure-all-have-base-frontmatter</span>
    |   |-- <span style="font-weight:bold;color:teal;">assure-clean-screenshots</span>
    |   |-- <span style="font-weight:bold;color:teal;">assure-clean-tags</span>
    |   |-- <span style="font-weight:bold;color:teal;">assure-clean-url-properties</span>
    |   |-- <span style="font-weight:bold;color:teal;">assure-one-site-uuid</span>
    |   |-- <span style="font-weight:bold;color:teal;">assure-safe-backlinks</span>
    |   |-- <span style="font-weight:bold;color:teal;">assure-safe-errors</span>
    |   |-- <span style="font-weight:bold;color:teal;">assure-unique-properties</span>
    |   |-- <span style="font-weight:bold;color:teal;">asure-clean-timestamps</span>
    |   |-- helperFunctions.cjs
    |   |-- runFrontmatterFixes.cjs
    |   |-- <span style="font-weight:bold;color:teal;">standardize-one-key</span>
    |   |-- <span style="font-weight:bold;color:teal;">standardize-one-line</span>
    |   |-- <span style="font-weight:bold;color:teal;">standarize-one-value</span>
    |   |-- <span style="font-weight:bold;color:teal;">standarize-reports</span>
    |   |-- <span style="font-weight:bold;color:teal;">standarize-separators-in-body</span>
    |   `-- tidyOneAtaTimeUtils.cjs
    |-- tidyCorruptedYAMLSyntax.cjs
    |-- <span style="font-weight:bold;color:teal;">tidyQuotesAsStringDelimiters</span>
    |   `-- detectAndFixQuotesOnKnownIrregularities.cjs
    `-- <span style="font-weight:bold;color:teal;">utils</span>

22 directories, 23 files
</pre>